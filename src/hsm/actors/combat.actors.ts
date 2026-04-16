import { Weapons } from 'minecrafthawkeye'

import type { Entity, Item } from '@/types'

import {
	type BaseServiceState,
	createStatefulService
} from '@/hsm/helpers/createStatefulService.js'

import { GoalFollow } from '@/modules/plugins/goals.js'

import { canSeeEnemy } from '@/utils/combat/enemyVisibility'
import { hasMovementController } from '@/utils/combat/movementController'
import {
	clearMicroMovement,
	stopMeleeAttack,
	stopPathfinderMovement,
	stopRangedAttack
} from '@/utils/combat/runtimeControl'

interface MeleeAttackState extends BaseServiceState {
	currentTarget: Entity | null
}

interface RangedSkirmishState extends BaseServiceState {
	currentTarget: Entity | null
	weapon: Item | null
	weaponType: Weapons | null
}

interface ApproachingState extends BaseServiceState {
	currentTargetId: number | null
}

const logCombatRuntime = (event: string, payload: Record<string, unknown>) => {
	console.log(`[COMBAT] ${event}`, JSON.stringify(payload))
}

const isPvpTargetActive = (bot: any, enemy: Entity) => bot.pvp?.target?.id === enemy.id

const getCombatDistance = (position: any, entity: Entity): number =>
	position?.distanceTo?.(entity.position) ?? Number.POSITIVE_INFINITY

const meleeExitRangeBuffer = 1.5

const resolveCombatTarget = (
	context: any,
	currentTarget: Entity | null = null
): { entity: Entity | null; distance: number } => {
	const position = context.position ?? context.bot?.entity?.position ?? null
	const enemies = Array.isArray(context.enemies) ? context.enemies : []

	if (!position) {
		return context.nearestEnemy ?? { entity: null, distance: Infinity }
	}

	const pickVisibleTarget = (targetId: number | null): Entity | null => {
		if (targetId === null) {
			return null
		}

		return (
			enemies.find(
				(enemy: Entity) =>
					enemy?.id === targetId &&
					Boolean(enemy.isValid) &&
					getCombatDistance(position, enemy) <= context.preferences.maxDistToEnemy
			) ?? null
		)
	}

	const stickyTarget =
		pickVisibleTarget(currentTarget?.id ?? null) ??
		pickVisibleTarget(context.nearestEnemy.entity?.id ?? null)

	if (stickyTarget) {
		return {
			entity: stickyTarget,
			distance: getCombatDistance(position, stickyTarget)
		}
	}

	if (
		context.nearestEnemy?.entity &&
		Boolean(context.nearestEnemy.entity.isValid) &&
		context.nearestEnemy.distance <= context.preferences.maxDistToEnemy
	) {
		return context.nearestEnemy
	}

	const fallback = enemies
		.filter(
			(enemy: Entity) =>
				enemy?.position &&
				Boolean(enemy.isValid) &&
				getCombatDistance(position, enemy) <= context.preferences.maxDistToEnemy
		)
		.sort(
			(left: Entity, right: Entity) =>
				getCombatDistance(position, left) - getCombatDistance(position, right)
		)[0]

	return fallback
		? {
				entity: fallback,
				distance: getCombatDistance(position, fallback)
			}
		: { entity: null, distance: Infinity }
}

const issueMeleeAttack = (
	bot: any,
	enemy: Entity,
	sendBack: (event: any) => void
) => {
	const attackResult = bot.pvp.attack(enemy)

	if (attackResult instanceof Promise) {
		void attackResult.catch((error: unknown) => {
			console.error(
				'[COMBAT] melee_attack_failed',
				error instanceof Error ? error.message : String(error)
			)
			sendBack({
				type: 'ERROR',
				error: error instanceof Error ? error.message : String(error)
			})
		})
	}
}

const getWeaponType = (weaponName: string): Weapons => {
	if (weaponName.includes('crossbow')) return Weapons.crossbow
	return Weapons.bow
}

const resolveRangedLoadout = (bot: any) => {
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

const hasValidCombatTarget = (context: any) => {
	const target = resolveCombatTarget(context)
	const { preferences } = context

	return (
		Boolean(target.entity?.isValid) && target.distance <= preferences.maxDistToEnemy
	)
}

const canEnterRangedSkirmish = (bot: any, context: any) => {
	const target = resolveCombatTarget(context)

	if (!target.entity || target.distance > context.preferences.maxDistToEnemy) {
		return false
	}

	return (
		target.distance > context.preferences.enemyMeleeRange &&
		resolveRangedLoadout(bot) !== null &&
		canSeeEnemy(bot, target.entity)
	)
}

const canExitMeleeToRanged = (
	bot: any,
	context: any,
	target: { entity: Entity | null; distance: number }
) => {
	if (!target.entity) {
		return false
	}

	return (
		target.distance > context.preferences.enemyMeleeRange + meleeExitRangeBuffer &&
		resolveRangedLoadout(bot) !== null &&
		canSeeEnemy(bot, target.entity)
	)
}

const serviceApproaching = createStatefulService<ApproachingState>({
	name: 'Approaching',
	tickInterval: 250,
	initialState: {
		currentTargetId: null
	},

	onTick: ({ context, bot, sendBack, state, setState }) => {
		const target = resolveCombatTarget(context)

		if (!target.entity) {
			if (state.currentTargetId !== null) {
				stopPathfinderMovement(bot)
				setState({ currentTargetId: null })
			}

			sendBack({ type: 'NO_ENEMIES' })
			return
		}

		const enemy = target.entity

		if (target.distance <= context.preferences.enemyMeleeRange) {
			stopPathfinderMovement(bot)
			setState({ currentTargetId: null })
			sendBack({ type: 'ENEMY_BECAME_CLOSE' })
			return
		}

		if (canEnterRangedSkirmish(bot, context)) {
			stopPathfinderMovement(bot)
			setState({ currentTargetId: null })
			sendBack({ type: 'ENEMY_BECAME_FAR' })
			return
		}

		if (state.currentTargetId !== enemy.id) {
			bot.pathfinder.setGoal(
				new GoalFollow(enemy as any, context.preferences.enemyMeleeRange)
			)
			setState({ currentTargetId: enemy.id })
		}
	},

	onCleanup: ({ bot, setState }) => {
		stopPathfinderMovement(bot)
		setState({ currentTargetId: null })
	}
})

const serviceMeleeAttack = createStatefulService<MeleeAttackState>({
	name: 'MeleeAttack',
	tickInterval: 500,
	initialState: {
		currentTarget: null
	},

	onStart: async ({ bot, abortSignal }) => {
		bot.utils.stopEating?.()

		const meleeWeapon = bot.utils.getMeleeWeapon()

		if (!meleeWeapon) {
			return
		}

		await bot.equip(meleeWeapon, 'hand')
		if (abortSignal.aborted) {
			return
		}

		console.log(`Melee equipped: ${meleeWeapon.name}`)
	},

	onTick: ({ context, state, bot, sendBack, setState }) => {
		const target = resolveCombatTarget(context, state.currentTarget)

		if (!target.entity) {
			if (state.currentTarget) {
				stopMeleeAttack(bot, 'no_enemies', logCombatRuntime)
				setState({ currentTarget: null })
			}

			sendBack({ type: 'NO_ENEMIES' })
			return
		}

		if (canExitMeleeToRanged(bot, context, target)) {
			if (state.currentTarget) {
				stopMeleeAttack(bot, 'switch_to_ranged', logCombatRuntime)
				setState({ currentTarget: null })
			}

			sendBack({ type: 'ENEMY_BECAME_FAR' })
			return
		}

		const enemy = target.entity

		if (!state.currentTarget || state.currentTarget.id !== enemy.id) {
			if (state.currentTarget) {
				stopMeleeAttack(bot, 'retarget', logCombatRuntime)
			}

			issueMeleeAttack(bot, enemy, sendBack)
			setState({ currentTarget: enemy })
			logCombatRuntime('melee_attack_issued', {
				enemyId: enemy.id,
				distance: Number(target.distance.toFixed(2)),
				reason: 'target_changed'
			})
			return
		}

		if (!isPvpTargetActive(bot, enemy)) {
			issueMeleeAttack(bot, enemy, sendBack)
			logCombatRuntime('melee_attack_issued', {
				enemyId: enemy.id,
				distance: Number(target.distance.toFixed(2)),
				reason: 'controller_lost_target'
			})
		}
	},

	onCleanup: ({ bot, setState }) => {
		stopMeleeAttack(bot, 'cleanup', logCombatRuntime)
		setState({ currentTarget: null })
	}
})

const serviceRangedSkirmish = createStatefulService<RangedSkirmishState>({
	name: 'RangedSkirmish',
	asyncTickInterval: 250,
	initialState: {
		currentTarget: null,
		weapon: null,
		weaponType: null
	},

	onStart: async ({ bot, context, sendBack, setState, abortSignal }) => {
		bot.utils.stopEating?.()

		const loadout = resolveRangedLoadout(bot)
		const target = resolveCombatTarget(context)

		if (
			!loadout ||
			!target.entity ||
			!canSeeEnemy(bot, target.entity)
		) {
			sendBack({ type: 'ENEMY_BECAME_CLOSE' })
			return
		}

		try {
			await bot.equip(loadout.weapon, 'hand')
			if (abortSignal.aborted) {
				return
			}

			clearMicroMovement(bot)
			setState(loadout)
		} catch {
			sendBack({ type: 'ENEMY_BECAME_CLOSE' })
		}
	},

	onAsyncTick: async ({
		context,
		state,
		bot,
		sendBack,
		setState,
		abortSignal
	}) => {
		const target = resolveCombatTarget(context, state.currentTarget)

		if (!target.entity) {
			if (state.currentTarget) {
				stopRangedAttack(bot, 'no_enemies', logCombatRuntime)
				setState({ currentTarget: null, weapon: null, weaponType: null })
			}

			sendBack({ type: 'NO_ENEMIES' })
			return
		}

		const enemy = target.entity
		const loadout = resolveRangedLoadout(bot)
		const hasSight = canSeeEnemy(bot, enemy)

		if (
			target.distance <= context.preferences.enemyMeleeRange ||
			!loadout ||
			!hasSight
		) {
			if (state.currentTarget) {
				stopRangedAttack(bot, 'switch_to_melee', logCombatRuntime)
				setState({ currentTarget: null, weapon: null, weaponType: null })
			}

			sendBack({ type: 'ENEMY_BECAME_CLOSE' })
			return
		}

		if (
			state.weapon?.name !== loadout.weapon.name ||
			state.weaponType !== loadout.weaponType
		) {
			try {
				await bot.equip(loadout.weapon, 'hand')
				if (abortSignal.aborted) {
					return
				}
			} catch {
				sendBack({ type: 'ENEMY_BECAME_CLOSE' })
				return
			}
		}

		if (
			!state.currentTarget ||
			state.currentTarget.id !== enemy.id ||
			state.weapon?.name !== loadout.weapon.name ||
			state.weaponType !== loadout.weaponType
		) {
			if (state.currentTarget) {
				stopRangedAttack(bot, 'retarget', logCombatRuntime)
			}

			bot.hawkEye.autoAttack(enemy, loadout.weaponType)
			setState({
				currentTarget: enemy,
				weapon: loadout.weapon,
				weaponType: loadout.weaponType
			})
			logCombatRuntime('ranged_attack_issued', {
				enemyId: enemy.id,
				distance: Number(target.distance.toFixed(2)),
				weapon: loadout.weapon.name
			})
		}
	},

	onCleanup: ({ bot, setState }) => {
		stopRangedAttack(bot, 'cleanup', logCombatRuntime)
		clearMicroMovement(bot)
		setState({ currentTarget: null, weapon: null, weaponType: null })
	}
})

const serviceRangedAttack = serviceRangedSkirmish

export default {
	serviceApproaching,
	serviceMeleeAttack,
	serviceRangedAttack,
	serviceRangedSkirmish
}
