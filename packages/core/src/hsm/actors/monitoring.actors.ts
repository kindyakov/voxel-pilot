import Logger from '@/config/logger.js'

import type { MachineContext } from '@/hsm/context.js'
import {
	type BaseServiceState,
	createStatefulService
} from '@/hsm/helpers/createStatefulService.js'

import { assessMob, selectCombatDecision } from '@/utils/combat/selfDefense.js'
import { isFinitePosition } from '@/utils/minecraft/spatial.js'

interface TrackingState extends BaseServiceState {
	decisionKey: string | null
	decisionLoggedAt: number
	observationProblem: MachineContext['threatObservationProblem']
}

const serviceEntitiesTracking = createStatefulService<TrackingState>({
	name: 'serviceEntitiesTracking',
	tickInterval: 100,
	asyncTickInterval: 100,
	errorEvent: error => ({ type: 'THREAT_OBSERVATION_FAILED', error }),
	initialState: {
		decisionKey: null,
		decisionLoggedAt: 0,
		observationProblem: null
	},

	// Safety facts are published without waiting for attack-route selection.
	onTick: ({ bot, context, sendBack, state, setState }) => {
		if (!bot.entities || context.health <= 0) return
		const position = bot.entity?.position
		const candidates = Object.values(bot.entities).filter(
			entity =>
				entity &&
				entity !== bot.entity &&
				entity.isValid !== false &&
				!context.deadEntities.has(entity)
		)
		const invalidEntity = candidates.find(
			entity => !isFinitePosition(entity.position)
		)
		const problem = !isFinitePosition(position)
			? 'invalid_bot_position'
			: invalidEntity
				? 'invalid_entity_position'
				: null
		if (problem) {
			if (
				state.observationProblem !== problem &&
				context.threatObservationProblem !== problem
			) {
				Logger.warn('[OBSERVATION] invalid', {
					reason: problem,
					botId: bot.entity?.id ?? null,
					invalidEntity: invalidEntity
						? {
								id: invalidEntity.id,
								position: {
									x: String(invalidEntity.position?.x),
									y: String(invalidEntity.position?.y),
									z: String(invalidEntity.position?.z)
								}
							}
						: null,
					minecraftVersion: bot.registry?.version?.minecraftVersion ?? null,
					position: {
						x: String(position?.x),
						y: String(position?.y),
						z: String(position?.z)
					},
					velocity: {
						x: String(bot.entity?.velocity?.x),
						y: String(bot.entity?.velocity?.y),
						z: String(bot.entity?.velocity?.z)
					},
					yaw: String(bot.entity?.yaw),
					pitch: String(bot.entity?.pitch)
				})
			}
			setState({ observationProblem: problem })
			if (context.threatObservationProblem !== problem)
				sendBack({ type: 'THREAT_OBSERVATION_INVALID', reason: problem })
			return
		}
		if (state.observationProblem) {
			Logger.info('[OBSERVATION] restored', {
				previousProblem: state.observationProblem
			})
			setState({ observationProblem: null })
		}
		const radius = Math.max(
			context.preferences.maxObservDist,
			context.preferences.safeEatDistance
		)
		const observed = candidates.filter(
			entity => position.distanceTo(entity.position) <= radius
		)
		const enemies = observed.filter(
			entity => assessMob(context, entity) !== null
		)
		sendBack({
			type: 'UPDATE_ENTITIES',
			entities: observed.filter(entity => !enemies.includes(entity)),
			enemies,
			players: observed.filter(entity => entity.type === 'player')
		})
	},

	onAsyncTick: ({ getContext, sendBack, state, setState }) => {
		const context = getContext()
		if (
			context.health <= 0 ||
			context.threatObservationProblem ||
			!isFinitePosition(context.bot?.entity?.position)
		)
			return
		const decision = selectCombatDecision(context)
		const loadout = {
			melee: context.bot?.utils.getMeleeWeapon()?.name ?? null,
			ranged: context.bot?.utils.getRangeWeapon()?.name ?? null,
			arrows: Boolean(context.bot?.utils.getArrow())
		}
		const candidates = [...decision.candidates]
			.sort((a, b) => a.distance - b.distance || a.id - b.id)
			.slice(0, 5)
		const key = JSON.stringify({
			targetId: decision.target.entity?.id ?? null,
			candidates: candidates
				.map(({ id, reason }) => ({ id, reason }))
				.sort((a, b) => a.id - b.id),
			loadout,
			autoDefend: context.preferences.autoDefend,
			suppressed: context.combatStopRequested
		})
		if (
			key !== state.decisionKey ||
			(candidates.length > 0 && Date.now() - state.decisionLoggedAt >= 5000)
		) {
			Logger.info('[COMBAT] target_decision', {
				minecraftVersion:
					context.bot?.registry?.version?.minecraftVersion ?? null,
				targetId: decision.target.entity?.id ?? null,
				loadout,
				autoDefend: context.preferences.autoDefend,
				suppressed: context.combatStopRequested,
				candidateCount: decision.candidates.length,
				candidates: candidates.map(candidate => ({
					...candidate,
					distance: Number.isFinite(candidate.distance)
						? Number(candidate.distance.toFixed(2))
						: null
				}))
			})
			setState({ decisionKey: key, decisionLoggedAt: Date.now() })
		}
		sendBack({
			type: 'UPDATE_COMBAT_TARGET',
			combatTarget: decision.target
		})
	}
})

export default { serviceEntitiesTracking }
