import { Vec3 } from 'vec3'

import type { Block } from '@/types/index.js'

import Logger from '@/config/logger.js'

import {
	hasFreshThreatObservation,
	isHungerRecoverySafe,
	isRecoveryDistanceSafe,
	isRecoverySafe
} from '@/hsm/guards/survival.guards.js'
import {
	type BaseServiceState,
	createStatefulService
} from '@/hsm/helpers/createStatefulService.js'

import { EscapeRuntime } from '@/utils/combat/escapeRuntime.js'
import { hasPassabilityChanged } from '@/utils/combat/passability.js'
import { refreshRecoveryRelocation } from '@/utils/combat/recoveryRelocation.js'
import {
	stopMeleeAttack,
	stopRangedAttack
} from '@/utils/combat/runtimeControl.js'
import { nearestRetreatCreeper } from '@/utils/combat/selfDefense.js'
import type { SurvivalMode } from '@/utils/combat/survival.js'
import { isFinitePosition } from '@/utils/minecraft/spatial.js'

interface SafetyState extends BaseServiceState {
	escape: EscapeRuntime | null
	mode: SurvivalMode
	decisionKey: string | null
	safeAtDamageSequence: number | null
}

/** Safety is continuous; eating and route attempts can fail without releasing the obligation. */
const createSafetyService = (kind: 'health' | 'food' | 'retreat') =>
	createStatefulService<SafetyState>({
		name:
			kind === 'retreat'
				? 'TacticalRetreat'
				: kind === 'health'
					? 'EmergencyHealing'
					: 'EmergencyEating',
		tickInterval: 100,
		asyncTickInterval: 100,
		initialState: {
			escape: null,
			mode: 'IDLE',
			decisionKey: null,
			safeAtDamageSequence: null
		},
		onStart: ({ bot, context, setState }) => {
			stopMeleeAttack(bot, 'safety')
			stopRangedAttack(bot, 'safety')
			bot.utils.stopEating()
			setState({
				escape: new EscapeRuntime(bot, context.preferences)
			})
		},
		onTick: api => {
			const { bot, context, state, setState, sendBack } = api
			const escape = state.escape
			if (!escape || context.health <= 0) return
			const setMode = (
				mode: SurvivalMode,
				reason: string,
				threat = context.nearestThreat
			) => {
				const key = `${mode}:${reason}:${threat?.entityId ?? 'none'}`
				if (api.state.decisionKey !== key) {
					Logger.info('[SURVIVAL] decision', {
						behavior: kind,
						mode,
						reason,
						health: context.health,
						food: context.food,
						foodAvailable,
						threatId: threat?.entityId ?? null,
						distance: threat ? Number(threat.distance.toFixed(2)) : null,
						observationFresh: hasFreshThreatObservation(context)
					})
					setState({ decisionKey: key })
				}
				if (api.state.mode !== mode) {
					setState({ mode })
					sendBack({ type: 'SURVIVAL_MODE_CHANGED', mode })
				}
			}
			const foodAvailable = bot.utils.getAllFood().length > 0
			if (
				kind === 'health' &&
				context.recoveryNoFoodNotified === foodAvailable
			) {
				if (!foodAvailable)
					bot.chat(
						'Критическая ситуация: здоровье низкое, еды нет. Остаюсь в режиме выживания.'
					)
				sendBack({
					type: 'RECOVERY_FOOD_AVAILABILITY',
					available: foodAvailable
				})
			}
			const position: Vec3 = bot.entity.position
			if (!isFinitePosition(position) || context.threatObservationProblem) {
				setState({ safeAtDamageSequence: null })
				escape.stop()
				bot.utils.stopEating()
				setMode(
					'IDLE',
					context.threatObservationProblem ?? 'invalid_bot_position'
				)
				return
			}
			// Tactical escape ends with creeper safety, not the healing/eating radius.
			// Ordinary nearby mobs must not extend this obligation.
			if (kind === 'retreat') {
				bot.utils.stopEating()
				const exploding = nearestRetreatCreeper(context)
				if (!exploding) {
					escape.stop()
					setMode(
						'IDLE',
						hasFreshThreatObservation(context)
							? 'creeper_safe'
							: 'waiting_for_fresh_observation'
					)
					if (hasFreshThreatObservation(context))
						sendBack({ type: 'RETREAT_SAFE' })
					return
				}
				const owner = escape.move(exploding, context.threats, null)
				setMode(
					owner === 'NONE' ? 'IDLE' : owner,
					owner === 'NONE' ? 'no_escape_route' : 'creeper_danger',
					exploding
				)
				return
			}
			if (kind === 'food' && !isHungerRecoverySafe(context)) {
				escape.stop()
				bot.utils.stopEating()
				setMode('IDLE', 'eating_deferred_by_threat')
				return
			}
			const relocation = refreshRecoveryRelocation(context)
			if (relocation !== context.recoveryRelocation)
				sendBack({ type: 'RECOVERY_RELOCATION', relocation })
			if (relocation?.status === 'pending') {
				escape.stop()
				bot.utils.stopEating()
				setMode('IDLE', 'waiting_for_valid_relocation_observation')
				return
			}
			const threat = context.nearestThreat
			const safe = isRecoveryDistanceSafe(context)
			const relocating = relocation !== null
			const restored =
				kind === 'health'
					? context.health >= context.preferences.healthFullyRestored
					: context.food >= context.preferences.foodRestored
			if (!threat && !hasFreshThreatObservation(context)) {
				setState({ safeAtDamageSequence: null })
				escape.stop()
				bot.utils.stopEating()
				setMode('IDLE', 'waiting_for_fresh_observation')
				return
			}
			if (restored && safe && !relocating) {
				escape.stop()
				bot.utils.stopEating()
				setMode('IDLE', 'recovery_complete_and_safe')
				sendBack({
					type: kind === 'health' ? 'HEALTH_RESTORED' : 'FOOD_RESTORED'
				})
				return
			}
			if (safe && !relocating)
				setState({ safeAtDamageSequence: context.lastDamage.sequence })
			// Reaching safety latches the resting band, independently of the movement controller.
			// A new meal or completed healing still requires the outer safe boundary.
			const resting =
				kind === 'health' &&
				!restored &&
				(context.food >= context.preferences.foodRestored || !foodAvailable) &&
				api.state.safeAtDamageSequence === context.lastDamage.sequence
			const mustFlee =
				relocating ||
				(threat &&
					(!hasFreshThreatObservation(context) ||
						(bot.autoEat.isEating || resting
							? threat.distance <= context.preferences.interruptEatDistance
							: !safe)))
			if (mustFlee) {
				setState({ safeAtDamageSequence: null })
				bot.utils.stopEating()
				const owner = escape.move(
					threat,
					context.threats,
					safe ? (relocation?.goal ?? null) : null
				)
				setMode(
					owner === 'NONE' ? 'IDLE' : owner,
					owner === 'NONE'
						? 'no_escape_route'
						: relocating
							? 'relocating_after_damage'
							: 'threat_too_close'
				)
				return
			}
			escape.stop()
			if (context.food >= context.preferences.foodRestored) {
				setMode('IDLE', 'waiting_for_health_regeneration')
				return
			}
			if (!foodAvailable) {
				bot.utils.stopEating()
				setMode('IDLE', 'no_food')
				if (kind !== 'health')
					sendBack({
						type: 'RECOVERY_FAILED',
						cause: 'no_food',
						reason: 'Еды нет; безопасный отход завершён.'
					})
				return
			}
			setMode('EATING', 'safe_to_eat')
		},
		onAsyncTick: async api => {
			// EATING is an intent, not proof that a previous portion is still active.
			// Every new portion must re-establish the outer start boundary.
			if (api.state.mode !== 'EATING' || !isRecoverySafe(api.context)) return
			try {
				await api.bot.utils.eating()
			} catch (error) {
				if (
					!api.abortSignal.aborted &&
					api.state.mode === 'EATING' &&
					!api.context.recoveryRelocation
				)
					throw error
			}
		},
		onCleanup: ({ bot, state }) => {
			Logger.info('[SURVIVAL] stopped', { behavior: kind, mode: state.mode })
			try {
				state.escape?.stop()
			} finally {
				bot.utils.stopEating()
			}
		},
		onEvents: () => ({
			physicsTick: api => api.state.escape?.physicsTick(),
			path_update: (
				api,
				result: {
					status?: string
					path?: Array<{ x: number; y: number; z: number }>
				}
			) => api.state.escape?.routeUpdated(result),
			blockUpdate: (api, before: Block | null, after: Block | null) => {
				if (after && hasPassabilityChanged(before, after))
					api.state.escape?.worldChanged(after.position)
			}
		})
	})

export default {
	serviceEmergencyHealing: createSafetyService('health'),
	serviceEmergencyEating: createSafetyService('food'),
	serviceTacticalRetreat: createSafetyService('retreat')
}
