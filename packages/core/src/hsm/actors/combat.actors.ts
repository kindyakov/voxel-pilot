import type { Bot, Entity } from '@/types/index.js'
import { Weapons } from 'minecrafthawkeye'

import type { RuntimeLogger } from '@/config/runtimeLogger.js'

import type { MachineContext } from '@/hsm/context.js'
import { hasFreshThreatObservation } from '@/hsm/guards/survival.guards.js'
import {
	type BaseServiceState,
	type ServiceAPI,
	createStatefulService
} from '@/hsm/helpers/createStatefulService.js'
import type { MachineEvent } from '@/hsm/types.js'

import { AcceptedApproachRoute } from '@/utils/combat/approachRoute.js'
import {
	getMeleeExitRange,
	hasCurrentCombatPosition,
	hasRangedLoadout,
	resolveCombatTarget
} from '@/utils/combat/combatRange.js'
import { canSeeEnemy } from '@/utils/combat/enemyVisibility.js'
import {
	stopMeleeAttack,
	stopRangedAttack
} from '@/utils/combat/runtimeControl.js'
import {
	canUseMeleeLoadout,
	isDefensiveCandidate
} from '@/utils/combat/selfDefense.js'

interface MeleeAttackState extends BaseServiceState {
	currentTarget: Entity | null
	ready: boolean
	armed: boolean
	attackStarting: boolean
	attackGeneration: number
	route: AcceptedApproachRoute
}

interface RangedSkirmishState extends BaseServiceState {
	currentTarget: Entity | null
	weaponType: Weapons | null
	weaponSlot: number | null
}

export const createCombatActors = (logger: RuntimeLogger) => {
	const logCombatRuntime = (
		event: string,
		payload: Record<string, unknown>
	) => {
		logger.debug(`[COMBAT] ${event}`, payload)
	}

	const isPvpTargetActive = (bot: Bot, enemy: Entity) =>
		bot.pvp?.target?.id === enemy.id

	const issueMeleeAttack = (
		api: ServiceAPI<MeleeAttackState>,
		enemy: Entity
	) => {
		const { bot, sendBack } = api
		const attackGeneration = api.state.attackGeneration + 1
		api.setState({ attackStarting: true, attackGeneration })
		const attackResult = bot.pvp.attack(enemy, {
			canAttack: target => {
				const context = api.getContext()
				const weapon = bot.utils.getMeleeWeapon()
				return (
					!api.abortSignal.aborted &&
					api.state.ready &&
					context.movementOwner === 'PVP' &&
					context.combatTarget.entity === target &&
					context.enemies.includes(target) &&
					hasFreshThreatObservation(context) &&
					isDefensiveCandidate(context, target) &&
					canUseMeleeLoadout(context) &&
					Boolean(weapon) === api.state.armed &&
					(weapon
						? bot.heldItem?.type === weapon.type
						: bot.heldItem === null) &&
					canSeeEnemy(bot, target)
				)
			}
		})

		if (attackResult instanceof Promise) {
			void attackResult
				.then(() => {
					const context = api.getContext()
					if (
						!api.abortSignal.aborted &&
						api.state.attackGeneration === attackGeneration &&
						context.movementOwner === 'PVP' &&
						bot.pvp.target === enemy &&
						context.approachAttempts[enemy.id]?.blockedReason === 'approach'
					) {
						// Exhausted pursuit can still strike an enemy in reach. Native PVP
						// normally installs a tighter follow goal; this owner revokes that goal.
						bot.pathfinder.setGoal(null)
						bot.clearControlStates()
					}
				})
				.catch((error: unknown) => {
					logger.error('[COMBAT] melee_attack_failed', {
						error:
							error instanceof Error
								? (error.stack ?? error.message)
								: String(error)
					})
					sendBack({
						type: 'ERROR',
						error: error instanceof Error ? error.message : String(error)
					})
				})
				.finally(() => {
					if (
						!api.abortSignal.aborted &&
						api.state.attackGeneration === attackGeneration
					)
						api.setState({ attackStarting: false })
				})
		} else api.setState({ attackStarting: false })
	}

	const getWeaponType = (weaponName: string): Weapons => {
		if (weaponName.includes('crossbow')) return Weapons.crossbow
		return Weapons.bow
	}

	const resolveRangedLoadout = (bot: Bot) => {
		const weapon = bot.utils.getRangeWeapon()
		const arrows = bot.utils.getArrow()

		if (!weapon || !arrows) {
			return null
		}

		return {
			weapon,
			weaponType: getWeaponType(weapon.name)
		}
	}

	const canExitMeleeToRanged = (
		bot: Bot,
		context: MachineContext,
		target: { entity: Entity | null; distance: number }
	) => {
		if (!target.entity || !hasCurrentCombatPosition(context)) {
			return false
		}

		return (
			hasRangedLoadout(context) &&
			target.distance > getMeleeExitRange(context) &&
			target.distance <= context.preferences.rangedAttackRange &&
			canSeeEnemy(bot, target.entity)
		)
	}

	const updateMelee = (api: ServiceAPI<MeleeAttackState>) => {
		const { context, state, bot, sendBack, setState, abortSignal } = api
		if (!state.ready || abortSignal.aborted) return
		const weapon = bot.utils.getMeleeWeapon()
		if (
			!canUseMeleeLoadout(context) ||
			Boolean(weapon) !== state.armed ||
			(weapon ? bot.heldItem?.type !== weapon.type : bot.heldItem !== null)
		) {
			// Inventory availability is not permission to skip weapon preparation.
			// Re-enter through the HSM so the old controller stops before rearming.
			sendBack({ type: 'WEAPON_BROKEN' })
			return
		}
		const target = resolveCombatTarget(context)

		if (!target.entity || !hasCurrentCombatPosition(context)) {
			if (state.currentTarget) {
				stopMeleeAttack(bot, 'no_enemies', logger, logCombatRuntime)
				setState({ currentTarget: null })
			}

			sendBack({ type: 'NO_ENEMIES' })
			return
		}

		if (canExitMeleeToRanged(bot, context, target)) {
			if (state.currentTarget) {
				stopMeleeAttack(bot, 'switch_to_ranged', logger, logCombatRuntime)
				setState({ currentTarget: null })
			}

			sendBack({ type: 'ENEMY_BECAME_FAR' })
			return
		}

		const enemy = target.entity
		sendBack({
			type: 'APPROACH_SAMPLE',
			waypoint: state.route.sample(bot.entity.position)
		})
		if (abortSignal.aborted) return

		if (!state.currentTarget || state.currentTarget.id !== enemy.id) {
			if (state.currentTarget) {
				stopMeleeAttack(bot, 'retarget', logger, logCombatRuntime)
			}

			issueMeleeAttack(api, enemy)
			setState({ currentTarget: enemy })
			logCombatRuntime('melee_attack_issued', {
				enemyId: enemy.id,
				distance: Number(target.distance.toFixed(2)),
				reason: 'target_changed'
			})
			return
		}

		if (!state.attackStarting && !isPvpTargetActive(bot, enemy)) {
			issueMeleeAttack(api, enemy)
			logCombatRuntime('melee_attack_issued', {
				enemyId: enemy.id,
				distance: Number(target.distance.toFixed(2)),
				reason: 'controller_lost_target'
			})
		}
	}

	const serviceMeleeAttack = createStatefulService<MeleeAttackState>({
		logger,
		name: 'MeleeAttack',
		operationTimeoutMs: 15_000,
		tickInterval: 500,
		initialState: {
			currentTarget: null,
			ready: false,
			armed: false,
			attackStarting: false,
			attackGeneration: 0,
			route: new AcceptedApproachRoute()
		},
		onStart: async api => {
			const { bot, abortSignal, setState } = api
			setState({ route: new AcceptedApproachRoute() })
			bot.utils.stopEating?.()
			const meleeWeapon = bot.utils.getMeleeWeapon()
			if (meleeWeapon) {
				await bot.equip(meleeWeapon, 'hand', { signal: abortSignal })
				if (abortSignal.aborted) return
				logger.debug(`Melee equipped: ${meleeWeapon.name}`)
			} else {
				await bot.unequip('hand', { signal: abortSignal })
				if (abortSignal.aborted) return
			}
			setState({ ready: true, armed: Boolean(meleeWeapon) })
			// Read the current target after equip: it may have changed while awaiting inventory.
			updateMelee(api)
		},
		onTick: updateMelee,

		onEvents: () => ({
			physicsTick: updateMelee,
			path_reset: ({ state }) => state.route.clear(),
			goal_updated: ({ state }) => state.route.clear(),
			path_stop: ({ state }) => state.route.clear(),
			path_update: (
				{ sendBack, state },
				result: {
					status?: string
					path?: { x: number; y: number; z: number }[]
				}
			) => {
				if (result.path) state.route.publish(result.path)
				if (result.status === 'noPath' || result.status === 'timeout')
					sendBack({ type: 'APPROACH_ROUTE_FAILED' })
			}
		}),
		onCleanup: ({ bot, setState, state }) => {
			state.route.clear()
			stopMeleeAttack(bot, 'cleanup', logger, logCombatRuntime)
			setState({ currentTarget: null })
		}
	})

	/** Also runs during pending equip; it never starts another inventory operation. */
	const checkRangedConditions = (api: ServiceAPI<RangedSkirmishState>) => {
		const { context, bot, sendBack, abortSignal } = api
		if (abortSignal.aborted) return null
		const target = resolveCombatTarget(context)
		if (!target.entity || !canSeeEnemy(bot, target.entity)) {
			sendBack({ type: 'NO_ENEMIES' })
			return null
		}
		if (target.distance > context.preferences.rangedAttackRange) {
			sendBack({ type: 'ENEMY_BECAME_FAR' })
			return null
		}
		if (target.distance <= context.preferences.enemyMeleeRange) {
			sendBack({ type: 'ENEMY_BECAME_CLOSE' })
			return null
		}
		const loadout = resolveRangedLoadout(bot)
		if (!loadout || context.rangedUnavailable) {
			sendBack({ type: 'WEAPON_BROKEN' })
			return null
		}
		// Slot sync replaces Item objects, including after durability changes. Only
		// actual equipment changes invalidate the firing controller and its draw.
		if (
			api.state.currentTarget &&
			(bot.heldItem?.type !== loadout.weapon.type ||
				api.state.weaponType !== loadout.weaponType ||
				api.state.weaponSlot !== bot.getEquipmentDestSlot('hand'))
		) {
			stopRangedAttack(bot, 'weapon_changed', logCombatRuntime)
			api.setState({ currentTarget: null, weaponType: null, weaponSlot: null })
		}
		return { enemy: target.entity, distance: target.distance, ...loadout }
	}

	const updateRanged = async (api: ServiceAPI<RangedSkirmishState>) => {
		const { bot, sendBack, setState, abortSignal } = api
		let candidate = checkRangedConditions(api)
		if (!candidate) return
		if (bot.heldItem?.type !== candidate.weapon.type) {
			try {
				await bot.equip(candidate.weapon, 'hand', { signal: abortSignal })
				if (abortSignal.aborted) return
			} catch (error) {
				sendBack({
					type: 'RANGED_UNAVAILABLE',
					reason: error instanceof Error ? error.message : String(error)
				})
				return
			}
			// Equip can outlive the target, its range, visibility, or the ammunition.
			candidate = checkRangedConditions(api)
			if (!candidate || bot.heldItem?.type !== candidate.weapon.type) return
		}
		const { enemy, distance, weapon, weaponType } = candidate
		const { state } = api
		if (state.currentTarget?.id === enemy.id && state.weaponType === weaponType)
			return
		// HawkEye owns the draw; changing aim must not release or restart it.
		bot.hawkEye.autoAttack(enemy, weaponType)
		setState({
			currentTarget: enemy,
			weaponType,
			weaponSlot: bot.getEquipmentDestSlot('hand')
		})
		logCombatRuntime('ranged_attack_issued', {
			enemyId: enemy.id,
			distance: Number(distance.toFixed(2)),
			weapon: weapon.name
		})
	}

	const serviceRangedSkirmish = createStatefulService<RangedSkirmishState>({
		logger,
		name: 'RangedSkirmish',
		operationTimeoutMs: 15_000,
		asyncTickInterval: 250,
		initialState: { currentTarget: null, weaponType: null, weaponSlot: null },
		onStart: async api => {
			api.bot.utils.stopEating?.()
			await updateRanged(api)
		},
		onAsyncTick: updateRanged,
		onEvents: () => ({
			physicsTick: api => {
				checkRangedConditions(api)
			}
		}),

		onCleanup: ({ bot, setState }) => {
			stopRangedAttack(bot, 'cleanup', logCombatRuntime)
			setState({ currentTarget: null, weaponType: null, weaponSlot: null })
		}
	})

	const serviceRangedAttack = serviceRangedSkirmish

	return {
		serviceMeleeAttack,
		serviceRangedAttack,
		serviceRangedSkirmish
	}
}
