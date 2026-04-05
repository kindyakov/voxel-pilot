import { Weapons } from 'minecrafthawkeye'

import type { Entity, Item } from '@/types'

import {
	type BaseServiceState,
	createStatefulService
} from '@/hsm/helpers/createStatefulService.js'

import { GoalFollow, GoalXZ } from '@/modules/plugins/goals.js'

import { canSeeEnemy } from '@/utils/combat/enemyVisibility'
import { hasMovementController } from '@/utils/combat/movementController'

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

const stopMeleeAttack = (bot: any) => {
	bot.pvp.stop()
}

const stopRangedAttack = (bot: any) => {
	bot.hawkEye.stop()
}

const clearMicroMovement = (bot: any) => {
	if (typeof bot.setControlState !== 'function') {
		return
	}

	bot.setControlState('forward', false)
	bot.setControlState('sprint', false)
	bot.setControlState('jump', false)
}

const stopPathfinderMovement = (bot: any) => {
	bot.pathfinder.setGoal(null)
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
	const { nearestEnemy, preferences } = context

	return (
		Boolean(nearestEnemy?.entity?.isValid) &&
		nearestEnemy.distance <= preferences.maxDistToEnemy
	)
}

const canEnterRangedSkirmish = (bot: any, context: any) => {
	if (!hasValidCombatTarget(context) || !context.nearestEnemy.entity) {
		return false
	}

	return (
		context.nearestEnemy.distance > context.preferences.enemyMeleeRange &&
		resolveRangedLoadout(bot) !== null &&
		canSeeEnemy(bot, context.nearestEnemy.entity)
	)
}

const serviceApproaching = createStatefulService<ApproachingState>({
	name: 'Approaching',
	tickInterval: 250,
	initialState: {
		currentTargetId: null
	},

	onTick: ({ context, bot, sendBack, state, setState }) => {
		if (!hasValidCombatTarget(context) || !context.nearestEnemy.entity) {
			if (state.currentTargetId !== null) {
				stopPathfinderMovement(bot)
				setState({ currentTargetId: null })
			}

			sendBack({ type: 'NO_ENEMIES' })
			return
		}

		const enemy = context.nearestEnemy.entity

		if (context.nearestEnemy.distance <= context.preferences.enemyMeleeRange) {
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
		if (!hasValidCombatTarget(context) || !context.nearestEnemy.entity) {
			if (state.currentTarget) {
				stopMeleeAttack(bot)
				setState({ currentTarget: null })
			}

			sendBack({ type: 'NO_ENEMIES' })
			return
		}

		if (canEnterRangedSkirmish(bot, context)) {
			if (state.currentTarget) {
				stopMeleeAttack(bot)
				setState({ currentTarget: null })
			}

			sendBack({ type: 'ENEMY_BECAME_FAR' })
			return
		}

		const enemy = context.nearestEnemy.entity

		if (!state.currentTarget || state.currentTarget.id !== enemy.id) {
			if (state.currentTarget) {
				stopMeleeAttack(bot)
			}

			bot.pvp.attack(enemy)
			setState({ currentTarget: enemy })
		}
	},

	onCleanup: ({ bot, setState }) => {
		stopMeleeAttack(bot)
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

		if (
			!loadout ||
			!context.nearestEnemy.entity ||
			!canSeeEnemy(bot, context.nearestEnemy.entity)
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
		if (!hasValidCombatTarget(context) || !context.nearestEnemy.entity) {
			if (state.currentTarget) {
				stopRangedAttack(bot)
				setState({ currentTarget: null, weapon: null, weaponType: null })
			}

			sendBack({ type: 'NO_ENEMIES' })
			return
		}

		const enemy = context.nearestEnemy.entity
		const loadout = resolveRangedLoadout(bot)
		const hasSight = canSeeEnemy(bot, enemy)

		if (
			context.nearestEnemy.distance <= context.preferences.enemyMeleeRange ||
			!loadout ||
			!hasSight
		) {
			if (state.currentTarget) {
				stopRangedAttack(bot)
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
				stopRangedAttack(bot)
			}

			bot.hawkEye.autoAttack(enemy, loadout.weaponType)
			setState({
				currentTarget: enemy,
				weapon: loadout.weapon,
				weaponType: loadout.weaponType
			})
		}
	},

	onCleanup: ({ bot, setState }) => {
		stopRangedAttack(bot)
		clearMicroMovement(bot)
		setState({ currentTarget: null, weapon: null, weaponType: null })
	}
})

const serviceFleeing = createStatefulService({
	name: 'Fleeing',
	tickInterval: 500,

	onStart: ({ bot }) => {
		bot.utils.stopEating?.()

		if (bot.movements) {
			bot.movements.allowSprinting = true
		}
	},

	onTick: ({ bot, context, sendBack }) => {
		const { nearestEnemy, preferences, position } = context
		if (!position) return

		if (!hasValidCombatTarget(context) || !nearestEnemy.entity) {
			sendBack({ type: 'NO_ENEMIES' })
			return
		}

		const enemyPos = nearestEnemy.entity.position
		const direction = position.clone().subtract(enemyPos).normalize()
		const fleeTarget = position
			.clone()
			.add(direction.scaled(preferences.fleeTargetDistance))

		bot.pathfinder.setGoal(
			new GoalXZ(Math.floor(fleeTarget.x), Math.floor(fleeTarget.z))
		)
	},

	onCleanup: ({ bot }) => {
		stopPathfinderMovement(bot)
	}
})

const serviceRangedAttack = serviceRangedSkirmish

export default {
	serviceApproaching,
	serviceFleeing,
	serviceMeleeAttack,
	serviceRangedAttack,
	serviceRangedSkirmish
}
