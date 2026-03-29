import {
	type BaseServiceState,
	createStatefulService
} from '@/hsm/helpers/createStatefulService.js'
import { Weapons } from 'minecrafthawkeye'

import type { Entity, Item } from '@types'

import { GoalXZ } from '@modules/plugins/goals.js'

import { canSeeEnemy } from '@utils/combat/enemyVisibility'

interface MeleeAttackState extends BaseServiceState {
	currentTarget: Entity | null
}

interface RangedAttackState extends BaseServiceState {
	currentTarget: Entity | null
	weapon: Item | null
	weaponType: Weapons | null
}

const stopMeleeAttack = (bot: any) => {
	bot.pvp.stop()
}

const stopRangedAttack = (bot: any) => {
	bot.hawkEye.stop()
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

const serviceMeleeAttack = createStatefulService<MeleeAttackState>({
	name: 'MeleeAttack',
	tickInterval: 500,
	initialState: {
		currentTarget: null
	},

	onStart: async ({ bot, abortSignal }) => {
		const meleeWeapon = bot.utils.getMeleeWeapon() // поиск оружия меч/топор

		if (meleeWeapon) {
			await bot.equip(meleeWeapon, 'hand')
			if (abortSignal.aborted) {
				return
			}
			console.log(`🗡️ Экипировал оружие: ${meleeWeapon.name}`)
		} else {
			console.log('🗡️ Нет оружия ближнего боя❗')
		}
	},

	onTick: ({ context, state, bot, sendBack, setState }) => {
		const { nearestEnemy, preferences } = context

		if (
			!nearestEnemy?.entity?.isValid ||
			nearestEnemy.distance > preferences.maxDistToEnemy
		) {
			console.log('⚔️ Нет валидного врага для атаки')

			if (state.currentTarget) {
				stopMeleeAttack(bot)
				setState({ currentTarget: null })
			}

			sendBack({ type: 'NO_ENEMIES' })
			return
		}

		const enemy = nearestEnemy.entity
		const distance = nearestEnemy.distance

		if (distance > preferences.enemyRangedRange) {
			const weapon = bot.utils.getRangeWeapon() // поиск оружия лук/арбалет
			const arrows = bot.utils.getArrow()
			const isSeeEnemy = canSeeEnemy(bot, nearestEnemy.entity)

			if (weapon && arrows && isSeeEnemy) {
				sendBack({ type: 'ENEMY_BECAME_FAR' })
				return
			}
		}

		if (!state.currentTarget || state.currentTarget.id !== enemy.id) {
			console.log(`⚔️ Атакую ${enemy.name}, id: ${enemy.id}`)
			if (state.currentTarget) stopMeleeAttack(bot)
			bot.pvp.attack(enemy)
			setState({ currentTarget: enemy })
		}
	},

	onCleanup: ({ bot, setState }) => {
		stopMeleeAttack(bot)
		setState({ currentTarget: null })
	}
})

const getWeaponType = (weaponName: string): Weapons => {
	if (weaponName.includes('bow')) return Weapons.bow
	if (weaponName.includes('crossbow')) return Weapons.crossbow

	return Weapons.bow
}

const serviceRangedAttack = createStatefulService<RangedAttackState>({
	name: 'RangedAttack',
	tickInterval: 1500,
	initialState: {
		currentTarget: null,
		weapon: null,
		weaponType: null
	},

	onStart: async ({ bot, sendBack, setState, context, abortSignal }) => {
		const loadout = resolveRangedLoadout(bot)
		const isSeeEnemy =
			context.nearestEnemy.entity !== null &&
			canSeeEnemy(bot, context.nearestEnemy.entity)

		if (!loadout || !isSeeEnemy) {
			sendBack({ type: 'ENEMY_BECAME_CLOSE' })
			return
		}

		try {
			await bot.equip(loadout.weapon, 'hand')
			if (abortSignal.aborted) {
				return
			}
			console.log(
				`🏹 Экипировал: ${loadout.weapon.name} (${loadout.weaponType})`
			)
			setState(loadout)
		} catch (error) {
			sendBack({ type: 'ENEMY_BECAME_CLOSE' })
		}
	},

	onTick: ({ context, state, bot, sendBack, setState }) => {
		const { nearestEnemy, preferences } = context

		if (
			!nearestEnemy?.entity?.isValid ||
			nearestEnemy.distance > preferences.maxDistToEnemy
		) {
			console.log('⚔️ Нет валидного врага для атаки')

			if (state.currentTarget) {
				stopRangedAttack(bot)
				setState({ currentTarget: null })
			}

			sendBack({ type: 'NO_ENEMIES' })
			return
		}

		const enemy = nearestEnemy.entity
		const distance = nearestEnemy.distance
		const isSeeEnemy = canSeeEnemy(bot, nearestEnemy.entity)
		const hasLoadout = resolveRangedLoadout(bot)

		if (distance <= preferences.enemyMeleeRange || !isSeeEnemy || !hasLoadout) {
			if (state.currentTarget) {
				stopRangedAttack(bot)
				setState({ currentTarget: null, weapon: null, weaponType: null })
			}
			sendBack({ type: 'ENEMY_BECAME_CLOSE' })
			return
		}

		if (!state.currentTarget || state.currentTarget.id !== enemy.id) {
			console.log(`🏹 Стреляю в ${enemy.name} ${enemy.id}`)
			if (state.currentTarget) stopRangedAttack(bot)

			if (state.weaponType) {
				bot.hawkEye.autoAttack(enemy, state.weaponType)
			}

			setState({ currentTarget: enemy })
		}
	},

	onCleanup: ({ bot, setState }) => {
		stopRangedAttack(bot)
		setState({ currentTarget: null, weapon: null, weaponType: null })
	}
})

const serviceFleeing = createStatefulService({
	name: 'Fleeing',
	tickInterval: 500,

	onStart: ({ bot }) => {
		console.log('🏃 Тактическое отступление')
		if (bot.movements) {
			bot.movements.allowSprinting = true
		}
	},

	onTick: ({ bot, context, sendBack }) => {
		const { nearestEnemy, preferences, position } = context
		if (!position) return

		// Нет врагов - выходим
		if (
			!nearestEnemy?.entity?.isValid ||
			nearestEnemy.distance > preferences.maxDistToEnemy
		) {
			sendBack({ type: 'NO_ENEMIES' })
			return
		}

		const enemy = nearestEnemy.entity

		// Просто убегаем от врага
		const enemyPos = enemy.position
		const direction = position.clone().subtract(enemyPos).normalize()
		const fleeTarget = position
			.clone()
			.add(direction.scaled(preferences.fleeTargetDistance))

		console.log(`🏃 Отхожу от ${enemy.name}`)

		bot.pathfinder.setGoal(
			new GoalXZ(Math.floor(fleeTarget.x), Math.floor(fleeTarget.z))
		)
	},

	onCleanup: ({ bot }) => {
		bot.pathfinder.setGoal(null)
	}
})

export default {
	serviceFleeing,
	serviceMeleeAttack,
	serviceRangedAttack
}
