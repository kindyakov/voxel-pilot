import { Weapons } from 'minecrafthawkeye'
import type { Entity, Item } from '@types'
import {
	createStatefulService,
	type BaseServiceState
} from '@/hsm/helpers/createStatefulService.js'
import { GoalXZ } from '@modules/plugins/goals.js'

interface MeleeAttackState extends BaseServiceState {
	currentTarget: Entity | null
}

interface RangedAttackState extends BaseServiceState {
	currentTarget: Entity | null
	weapon: Item | null
	weaponType: Weapons | null
}

const serviceMeleeAttack = createStatefulService<MeleeAttackState>({
	name: 'MeleeAttack',
	tickInterval: 500,
	initialState: {
		currentTarget: null
	},

	onStart: ({ bot }) => {
		const meleeWeapon = bot.utils.getMeleeWeapon() // поиск оружия меч/топор

		if (meleeWeapon) {
			console.log(`🗡️ Экипировал оружие: ${meleeWeapon.name}`)
			bot.equip(meleeWeapon, 'hand')
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
				bot.pvp.stop()
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

			if (weapon && arrows) {
				sendBack({ type: 'ENEMY_BECAME_FAR' })
				return
			}
		}

		if (!state.currentTarget || state.currentTarget.id !== enemy.id) {
			console.log(`⚔️ Атакую ${enemy.name}, id: ${enemy.id}`)
			if (state.currentTarget) bot.pvp.stop()
			bot.pvp.attack(enemy)
			setState({ currentTarget: enemy })
		}
	}
})

const getWeaponType = (weaponName: string): Weapons => {
	if (weaponName.includes('bow')) return Weapons.bow
	if (weaponName.includes('crossbow')) return Weapons.crossbow
	if (weaponName.includes('trident')) return Weapons.trident

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

	onStart: ({ bot, sendBack, setState }) => {
		const weapon = bot.utils.getRangeWeapon() // поиск оружия лук/арбалет
		const arrows = bot.utils.getArrow()

		if (weapon && arrows) {
			bot.equip(weapon, 'hand')
			const weaponType = getWeaponType(weapon.name)
			console.log(`🏹 Экипировал: ${weapon.name} (${weaponType})`)
			setState({ weapon, weaponType })
		} else {
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
				bot.hawkEye.stop()
				setState({ currentTarget: null })
			}

			sendBack({ type: 'NO_ENEMIES' })
			return
		}

		const enemy = nearestEnemy.entity
		const distance = nearestEnemy.distance

		if (distance <= preferences.enemyMeleeRange) {
			sendBack({ type: 'ENEMY_BECAME_CLOSE' })
			return
		}

		if (!state.currentTarget || state.currentTarget.id !== enemy.id) {
			console.log(`🏹 Стреляю в ${enemy.name} ${enemy.id}`)
			if (state.currentTarget) bot.hawkEye.stop()

			if (state.weaponType) {
				bot.hawkEye.autoAttack(enemy, state.weaponType)
			}

			setState({ currentTarget: enemy })
		}
	},

	onCleanup: ({ bot }) => {}
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
	}
})

export default {
	serviceFleeing,
	serviceMeleeAttack,
	serviceRangedAttack
}
