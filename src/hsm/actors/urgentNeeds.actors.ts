import {
	createStatefulService,
	type BaseServiceState
} from '@/hsm/helpers/createStatefulService.js'
import { GoalNear } from '@modules/plugins/goals.js'
import {
	calculateDangerCenter,
	updateMovementFlee,
	updatePathfinderFlee,
	switchToMovementMode,
	switchToPathfinderMode,
	switchToEatingMode,
	cleanupFleeMode,
	determineFleeMode,
	FLEE_THRESHOLDS,
	type FleeMode
} from '@utils/combat'

interface EmergencyHealingState extends BaseServiceState {
	isEating: boolean
	lastFleeTime: number
	fleeMode: FleeMode
}

const serviceEmergencyHealing = createStatefulService<EmergencyHealingState>({
	name: 'EmergencyHealing',
	tickInterval: 100, // Быстрее реакция для гибридной системы

	initialState: {
		isEating: false,
		lastFleeTime: 0,
		fleeMode: 'IDLE'
	},

	onStart: ({ bot }) => {
		console.log('🚨 КРИТИЧЕСКОЕ ЗДОРОВЬЕ! Режим выживания')
		bot.chat('Мне плохо! Нужно срочно вылечиться!')

		if (bot.movements) {
			bot.movements.allowSprinting = true
		}
	},

	onTick: ({ bot, context, state, sendBack, setState }) => {
		const { health, preferences, position, enemies, nearestEnemy } = context

		// 1. Здоровье восстановлено - выходим
		if (health > preferences.healthFullyRestored) {
			console.log('💚 Здоровье восстановлено!')
			cleanupFleeMode(bot)
			bot.utils.stopEating()
			sendBack({ type: 'HEALTH_RESTORED' })
			return
		}

		// 2. Нет врагов - можно лечиться на месте
		if (enemies.length === 0) {
			if (state.fleeMode !== 'EATING') {
				console.log('✅ Врагов нет, лечусь на месте')
				switchToEatingMode(bot)
				setState({ fleeMode: 'EATING' })
			}
			bot.utils.eating()
			setState({ isEating: true })
			return
		}

		const hasFood = bot.utils.getAllFood().length > 0

		if (!hasFood) {
			console.log('⚠️ НЕТ ЕДЫ! Просто убегаю')
			bot.chat('У меня нет еды! Помогите!')
		}

		if (!position) {
			throw Error('Position is null in actors EmergencyHealing')
		}

		// 3. Проверяем: можно ли убежать к игроку
		const player = bot.utils.searchPlayer()
		const canFleeToPlayer =
			player &&
			(() => {
				const playerPos = player.position
				const playerToBotDist = playerPos.distanceTo(position)

				// Игрок слишком далеко
				if (playerToBotDist > preferences.fleeToPlayerRadius) {
					return false
				}

				// Проверяем что все враги далеко от игрока
				const allEnemiesFarFromPlayer = enemies.every(enemy => {
					const distToPlayer = enemy.position.distanceTo(playerPos)
					return distToPlayer > preferences.safePlayerDistance
				})

				return allEnemiesFarFromPlayer
			})()

		// 4. Убегание к игроку (приоритет) - используем PATHFINDER
		if (canFleeToPlayer && nearestEnemy.distance < preferences.safeEatDistance) {
			if (state.fleeMode !== 'PATHFINDER') {
				console.log(`🏃‍♂️ Бегу к игроку "${player.username}"`)
				bot.chat(`${player.username}, спаси меня!`)
				switchToPathfinderMode(bot)
				setState({ fleeMode: 'PATHFINDER' })
			}

			bot.pathfinder.setGoal(
				new GoalNear(player.position.x, player.position.y, player.position.z, 3)
			)

			bot.utils.stopEating()
			setState({ isEating: false, lastFleeTime: Date.now() })
			return
		}

		// 5. ГИБРИДНОЕ УБЕГАНИЕ от врагов
		if (nearestEnemy.distance < preferences.safeEatDistance) {
			bot.utils.stopEating()
			setState({ isEating: false })

			// Определяем оптимальный режим убегания
			const targetMode = determineFleeMode(nearestEnemy.distance)

			// РЕЖИМ 1: MOVEMENT (близкая дистанция < 15 блоков)
			if (targetMode === 'MOVEMENT') {
				if (state.fleeMode !== 'MOVEMENT') {
					console.log(
						`🏃 Враг ОЧЕНЬ БЛИЗКО (${nearestEnemy.distance.toFixed(1)}м)! Динамическое убегание`
					)
					const dangerCenter = calculateDangerCenter(position, enemies)
					const newMode = switchToMovementMode(bot, dangerCenter)
					setState({ fleeMode: newMode, lastFleeTime: Date.now() })
				} else {
					// Обновляем цель убегания каждый тик
					const dangerCenter = calculateDangerCenter(position, enemies)
					updateMovementFlee(bot, dangerCenter)
				}
				return
			}

			// РЕЖИМ 2: PATHFINDER (средняя дистанция 15-25 блоков)
			if (targetMode === 'PATHFINDER') {
				if (state.fleeMode !== 'PATHFINDER') {
					console.log(
						`🏃 Враг близко (${nearestEnemy.distance.toFixed(1)}м)! Статическое убегание`
					)
					const newMode = switchToPathfinderMode(bot)
					setState({ fleeMode: newMode, lastFleeTime: Date.now() })
				}

				// Обновляем цель убегания через pathfinder
				if (nearestEnemy.entity) {
					const dangerCenter = calculateDangerCenter(position, enemies)
					updatePathfinderFlee(
						bot,
						position,
						dangerCenter,
						preferences.fleeTargetDistance
					)
				}
				return
			}
		}

		// 6. Враги далеко - останавливаемся и лечимся
		if (state.fleeMode !== 'EATING') {
			console.log(
				`✅ Враги далеко (${nearestEnemy.distance.toFixed(1)}м), лечусь`
			)
			const newMode = switchToEatingMode(bot)
			setState({ fleeMode: newMode })
		}
		bot.utils.eating()
		setState({ isEating: true })
	},

	onCleanup: ({ bot }) => {
		cleanupFleeMode(bot)
		bot.utils.stopEating()
	}
})

export default {
	serviceEmergencyHealing
}
