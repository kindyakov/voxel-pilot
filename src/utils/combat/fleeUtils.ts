/**
 * Утилиты для системы убегания от врагов
 * Гибридный подход: mineflayer-movement для близких дистанций + pathfinder для средних
 */

import type { Bot, Entity } from '@types'
import { Vec3 } from 'vec3'
import { GoalXZ } from '@/modules/plugins/goals'

// Режимы убегания
export type FleeMode = 'IDLE' | 'MOVEMENT' | 'PATHFINDER' | 'EATING'

// Дистанционные пороги для гибридной системы
export const FLEE_THRESHOLDS = {
	// Близкая дистанция - динамическое убегание через movement
	CLOSE_DISTANCE: 15,
	// Средняя дистанция - статическое убегание через pathfinder
	MEDIUM_DISTANCE: 25,
	// Дальняя дистанция - безопасно, можно лечиться
	SAFE_DISTANCE: 25
} as const

/**
 * Вычисляет "центр опасности" - средневзвешенную позицию всех врагов
 * Враги ближе к боту имеют больший вес
 */
export function calculateDangerCenter(
	botPosition: Vec3,
	enemies: Entity[]
): Vec3 {
	if (enemies.length === 0) {
		return botPosition.clone()
	}

	if (enemies.length === 1) {
		return enemies[0]?.position.clone()!
	}

	// Взвешенное среднее: ближние враги важнее
	let totalWeight = 0
	const weightedSum = new Vec3(0, 0, 0)

	for (const enemy of enemies) {
		const distance = botPosition.distanceTo(enemy.position)
		// Чем ближе враг, тем больше вес (обратная зависимость)
		// Минимальная дистанция = 1 для избежания деления на 0
		const weight = 1 / Math.max(distance, 1)

		weightedSum.add(enemy.position.scaled(weight))
		totalWeight += weight
	}

	return weightedSum.scaled(1 / totalWeight)
}

/**
 * Создает и настраивает Movement Goal для динамического убегания
 * Использует эвристики для принятия решений на ходу
 */
export function createFleeGoal(bot: Bot, dangerCenter: Vec3): void {
	// Проверка наличия movement API
	if (!bot.movement) {
		console.error('[FleeUtils] Movement API недоступен! Плагин не загружен?')
		return
	}

	try {
		// Создаем Goal с несколькими эвристиками
		const fleeGoal = new bot.movement.Goal({
			// 1. Избегание препятствий (стены, блоки)
			distance: bot.movement.heuristic
				.new('distance')
				.weight(2.0) // Высокий приоритет
				.radius(10) // Смотреть на 10 блоков вперед (баланс)
				.height(2) // Может подниматься на 2 блока
				.count(5), // 5 raycast лучей на направление

			// 2. Избегание опасностей (лава, ямы, вода)
			danger: bot.movement.heuristic
				.new('danger')
				.weight(3.0) // Критический приоритет!
				.radius(10) // Проверка опасности в радиусе 10 блоков
				.descent(3) // Не спускаться ниже 3 блоков
				.depth(4), // Проверять ямы глубиной до 4 блоков

			// 3. Убегание от центра опасности (все враги)
			proximity: bot.movement.heuristic
				.new('proximity')
				.weight(1.5) // Средний приоритет
				.target(dangerCenter)
				.avoid(true), // УБЕГАТЬ от цели!

			// 4. Плавность движения (не разворачиваться резко)
			conformity: bot.movement.heuristic
				.new('conformity')
				.weight(0.3) // Низкий приоритет (только для плавности)
				.avoid(false) // Продолжать текущее направление
		})

		bot.movement.setGoal(fleeGoal)
	} catch (error) {
		console.error('[FleeUtils] Ошибка создания FleeGoal:', error)
	}
}

/**
 * Обновляет цель убегания в реальном времени
 * Вызывается каждый тик для динамической адаптации
 */
export function updateMovementFlee(bot: Bot, dangerCenter: Vec3): void {
	if (!bot.movement || !bot.movement.heuristic) {
		return
	}

	try {
		// Обновляем позицию центра опасности
		const proximityHeuristic = bot.movement.heuristic.get('proximity')
		if (proximityHeuristic) {
			proximityHeuristic.target(dangerCenter)
		}

		// Вычисляем оптимальное направление с учетом всех эвристик
		const yaw = bot.movement.getYaw(
			180, // FOV 180 градусов (баланс между обзором и производительностью)
			12, // 12 направлений для проверки (баланс)
			1 // Усреднение соседних направлений для плавности
		)

		// Поворачиваем бота в безопасном направлении
		bot.movement.steer(yaw)
	} catch (error) {
		console.error('[FleeUtils] Ошибка обновления Movement flee:', error)
	}
}

/**
 * Обновляет цель убегания через pathfinder
 * Используется для средних дистанций
 */
export function updatePathfinderFlee(
	bot: Bot,
	botPosition: Vec3,
	enemyPosition: Vec3,
	fleeDistance: number = 20
): void {
	try {
		// Вычисляем направление от врага
		const direction = botPosition.clone().subtract(enemyPosition).normalize()

		// Вычисляем точку для убегания
		const fleeTarget = botPosition.clone().add(direction.scaled(fleeDistance))

		// Устанавливаем цель через pathfinder
		bot.pathfinder.setGoal(
			new GoalXZ(Math.floor(fleeTarget.x), Math.floor(fleeTarget.z)),
			true // Dynamic goal
		)
	} catch (error) {
		console.error('[FleeUtils] Ошибка установки Pathfinder goal:', error)
	}
}

/**
 * Переключает режим убегания на Movement (динамическое)
 */
export function switchToMovementMode(bot: Bot, dangerCenter: Vec3): FleeMode {
	try {
		// Останавливаем pathfinder
		bot.pathfinder.setGoal(null)

		// Запускаем movement
		createFleeGoal(bot, dangerCenter)

		// Активируем движение вперед и спринт
		bot.setControlState('forward', true)
		bot.setControlState('sprint', true)

		console.log(
			'[FleeUtils] 🏃 Переключено на MOVEMENT (динамическое убегание)'
		)
		return 'MOVEMENT'
	} catch (error) {
		console.error('[FleeUtils] Ошибка переключения на Movement:', error)
		return 'IDLE'
	}
}

/**
 * Переключает режим убегания на Pathfinder (статическое)
 */
export function switchToPathfinderMode(bot: Bot): FleeMode {
	try {
		// Останавливаем movement
		if (bot.movement) {
			bot.movement.setGoal(null)
		}

		// Отключаем ручное управление (pathfinder сам управляет)
		bot.setControlState('forward', false)
		bot.setControlState('sprint', false)

		console.log(
			'[FleeUtils] 🚶 Переключено на PATHFINDER (статическое убегание)'
		)
		return 'PATHFINDER'
	} catch (error) {
		console.error('[FleeUtils] Ошибка переключения на Pathfinder:', error)
		return 'IDLE'
	}
}

/**
 * Переключает режим на лечение (нет врагов или они далеко)
 */
export function switchToEatingMode(bot: Bot): FleeMode {
	try {
		// Останавливаем все системы передвижения
		cleanupFleeMode(bot)

		console.log('[FleeUtils] 🍖 Переключено на EATING (лечение)')
		return 'EATING'
	} catch (error) {
		console.error('[FleeUtils] Ошибка переключения на Eating:', error)
		return 'IDLE'
	}
}

/**
 * Очищает состояние убегания - останавливает все системы передвижения
 */
export function cleanupFleeMode(bot: Bot): void {
	try {
		// Останавливаем pathfinder
		bot.pathfinder.setGoal(null)

		// Останавливаем movement
		if (bot.movement) {
			bot.movement.setGoal(null)
		}

		// Отключаем все контролы
		bot.setControlState('forward', false)
		bot.setControlState('sprint', false)
		bot.setControlState('jump', false)
	} catch (error) {
		console.error('[FleeUtils] Ошибка очистки flee mode:', error)
	}
}

/**
 * Определяет оптимальный режим убегания на основе дистанции до врагов
 */
export function determineFleeMode(nearestEnemyDistance: number): FleeMode {
	if (nearestEnemyDistance < FLEE_THRESHOLDS.CLOSE_DISTANCE) {
		return 'MOVEMENT' // Динамическое убегание
	} else if (nearestEnemyDistance < FLEE_THRESHOLDS.MEDIUM_DISTANCE) {
		return 'PATHFINDER' // Статическое убегание
	} else {
		return 'EATING' // Безопасно, можно лечиться
	}
}
