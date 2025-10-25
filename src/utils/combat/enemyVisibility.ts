import type { Bot, Entity } from '@types'
import { GoalNear } from '@modules/plugins/goals'
import pathFinderPkg from 'mineflayer-pathfinder'

const { Movements } = pathFinderPkg

/**
 * Кеш результатов pathfinder для оптимизации
 * Ключ: `entityId`, Значение: { reachable: boolean, pathLength: number, timestamp: number }
 */
const pathfindCache = new Map<
	number,
	{ reachable: boolean; pathLength: number; timestamp: number }
>()

/**
 * УРОВЕНЬ 1: Проверка прямой видимости через raycast (БЫСТРО ~1ms)
 * @param bot - Mineflayer бот
 * @param enemy - Враг для проверки
 * @returns true если бот видит врага (нет solid блоков на линии)
 */
export function canSeeEnemy(bot: Bot, enemy: Entity): boolean {
	if (!enemy || !enemy.isValid || !enemy.position) {
		return false
	}

	// Позиция глаз бота (высота ~1.62 блока для игрока)
	const eyeHeight = bot.entity.height * 0.9 // Примерно уровень глаз
	const eyePos = bot.entity.position.offset(0, eyeHeight, 0)

	// Центр hitbox врага (приблизительно середина высоты)
	const targetHeight = enemy.height ? enemy.height / 2 : 0.9
	const targetPos = enemy.position.offset(0, targetHeight, 0)

	const distance = eyePos.distanceTo(targetPos)
	const direction = targetPos.minus(eyePos).normalize()

	// Raycast (проверка блоков на линии между ботом и врагом)
	// Проверяем блоки на линии с шагом 0.5 блока
	for (let i = 0.5; i < distance; i += 0.5) {
		const checkPos = eyePos.offset(
			direction.x * i,
			direction.y * i,
			direction.z * i
		)
		const blockAtPos = bot.blockAt(checkPos)

		// Пропускаем пустые и прозрачные блоки
		if (
			!blockAtPos ||
			blockAtPos.boundingBox === 'empty' ||
			blockAtPos.transparent ||
			!blockAtPos.material
		) {
			continue
		}

		// Нашли solid блок - видимость заблокирована
		// console.log(
		// 	`🚫 [canSeeEnemy] ${enemy.name || enemy.username || 'враг'} НЕ ВИДЕН (блокирует ${blockAtPos.name})`
		// )
		return false
	}

	// Нет solid блоков на линии → ВИДИМ
	// console.log(
	// 	`👁️ [canSeeEnemy] ${enemy.name || enemy.username || 'враг'} ВИДЕН (прямая видимость)`
	// )
	return true
}

/**
 * УРОВЕНЬ 2: Проверка достижимости через pathfinder (МЕДЛЕННО ~50-500ms, С КЕШЕМ)
 *
 * ВАЖНО: Проверяет путь БЕЗ копания блоков (canDig = false).
 * Это означает что бот НЕ будет атаковать врагов:
 * - За стеной (нужно копать)
 * - Под землёй (нужно копать)
 * - В соседней шахте (нужно копать)
 *
 * Бот БУДЕТ атаковать врагов:
 * - На прямой видимости
 * - За забором с путём обхода
 * - За углом с путём обхода
 *
 * @param bot - Mineflayer бот
 * @param enemy - Враг для проверки
 * @param maxPathLength - Максимальная длина пути
 * @param timeout - Timeout для pathfinder (мс)
 * @param cacheDuration - Время жизни кеша (мс)
 * @returns Promise<true> если путь существует и не слишком длинный
 */
export async function isEnemyReachable(
	bot: Bot,
	enemy: Entity,
	maxPathLength: number,
	timeout: number = 1000,
	cacheDuration: number = 3000
): Promise<boolean> {
	if (!enemy || !enemy.isValid || !enemy.position) {
		return false
	}

	const now = Date.now()
	const cached = pathfindCache.get(enemy.id)

	// Проверка кеша
	if (cached && now - cached.timestamp < cacheDuration) {
		// console.log(
		// 	`📦 [isEnemyReachable] ${enemy.name || 'враг'} (из кеша: ${cached.reachable ? 'ДОСТИЖИМ' : 'НЕ достижим'})`
		// )
		return cached.reachable
	}

	const botPos = bot.entity.position
	const enemyPos = enemy.position
	const distance = botPos.distanceTo(enemyPos)
	const heightDiff = botPos.y - enemyPos.y

	// БЫСТРАЯ ПРОВЕРКА: Враг явно в яме/под землёй?
	// Если враг находится намного ниже и под ним solid блок - это яма, недостижима без копания
	const blockAtBot = bot.blockAt(botPos)
	const blockBelowBot = bot.blockAt(botPos.offset(0, -1, 0))
	const blockAtEnemy = bot.blockAt(enemyPos)
	const blockBelowEnemy = bot.blockAt(enemyPos.offset(0, -1, 0))

	// Враг на 4+ блока ниже И под ним solid блок → в яме, недостижим
	if (heightDiff >= 4 && blockBelowEnemy && blockBelowEnemy.material) {
		// console.log(
		// 	`⚡ [isEnemyReachable] БЫСТРАЯ ПРОВЕРКА: враг в яме (на ${heightDiff.toFixed(1)} блок(ов) ниже, под ним ${blockBelowEnemy.name}), недостижим без копания`
		// )
		pathfindCache.set(enemy.id, {
			reachable: false,
			pathLength: Infinity,
			timestamp: now
		})
		return false
	}

	try {
		// Создаём временный Movements с ОТКЛЮЧЕННЫМ копанием блоков
		// Используется ТОЛЬКО для проверки достижимости
		const checkMovements = new Movements(bot)
		checkMovements.canDig = false // ← НЕ ломать блоки при проверке
		checkMovements.allowParkour = bot.movements.allowParkour
		checkMovements.allowSprinting = bot.movements.allowSprinting

		// Создаём goal для pathfinder
		const goal = new GoalNear(
			enemy.position.x,
			enemy.position.y,
			enemy.position.z,
			2
		)

		// ИСПРАВЛЕНИЕ: Используем генератор правильно чтобы A* полностью завершила поиск
		// getPathFromTo() возвращает генератор который итерирует A* поиск
		// Это критично с canDig = false, так как нужно несколько итераций для полного исследования
		const generator = bot.pathfinder.getPathFromTo(
			checkMovements,
			bot.entity.position,
			goal,
			{ timeout }
		)

		let path: any = null
		let iterationCount = 0
		const maxIterations = 1000 // Безопасность от бесконечного цикла

		// Итерируем генератор до завершения поиска
		// A* поиск может требовать несколько итераций для полного исследования пространства
		for (const yielded of generator) {
			iterationCount++
			path = yielded.result

			// Выходим если поиск завершён (не partial)
			if (path.status !== 'partial') {
				break
			}

			// Безопасность от бесконечного цикла
			if (iterationCount >= maxIterations) {
				break
			}
		}

		// Проверяем результат поиска
		if (!path || path.status !== 'success') {
			// console.log(
			// 	`❌ [isEnemyReachable] ${enemy.name || 'враг'} НЕ ДОСТИЖИМ (статус: ${path?.status || 'null'})`
			// )
			pathfindCache.set(enemy.id, {
				reachable: false,
				pathLength: Infinity,
				timestamp: now
			})
			return false
		}

		// Считаем длину пути
		const pathLength = path.path?.length || 0

		if (pathLength === 0) {
			console.log(
				`❌ [isEnemyReachable] ${enemy.name || 'враг'} НЕ ДОСТИЖИМ (путь пустой)`
			)
			pathfindCache.set(enemy.id, {
				reachable: false,
				pathLength: 0,
				timestamp: now
			})
			return false
		}

		if (pathLength > maxPathLength) {
			console.log(
				`⚠️ [isEnemyReachable] ${enemy.name || 'враг'} НЕ ДОСТИЖИМ (путь ${pathLength} > макс ${maxPathLength})`
			)
			pathfindCache.set(enemy.id, {
				reachable: false,
				pathLength,
				timestamp: now
			})
			return false
		}

		console.log(
			`✅ [isEnemyReachable] ${enemy.name || 'враг'} ДОСТИЖИМ (путь: ${pathLength} блоков)`
		)
		pathfindCache.set(enemy.id, {
			reachable: true,
			pathLength,
			timestamp: now
		})
		return true
	} catch (error) {
		console.log(
			`⚠️ [isEnemyReachable] Ошибка проверки пути: ${error instanceof Error ? error.message : String(error)}`
		)
		pathfindCache.set(enemy.id, {
			reachable: false,
			pathLength: Infinity,
			timestamp: now
		})
		return false
	}
}

/**
 * ПОЛНАЯ 3-УРОВНЕВАЯ ФИЛЬТРАЦИЯ
 * @param bot - Mineflayer бот
 * @param enemy - Враг для проверки
 * @param maxDistance - Макс. дистанция (уровень 1)
 * @param maxPathLength - Макс. длина пути (уровень 3)
 * @param pathfindTimeout - Timeout для pathfinder
 * @returns Promise<boolean> - можно ли атаковать врага
 */
export async function canAttackEnemy(
	bot: Bot,
	enemy: Entity,
	maxDistance: number,
	maxPathLength: number,
	pathfindTimeout: number
): Promise<boolean> {
	if (!enemy || !enemy.isValid || !enemy.position || !bot.entity.position) {
		return false
	}

	// УРОВЕНЬ 1: Проверка дистанции (быстро)
	const distance = bot.entity.position.distanceTo(enemy.position)
	if (distance > maxDistance) {
		// console.log(
		// 	`📏 [canAttackEnemy] ${enemy.name || 'враг'} слишком далеко (${distance.toFixed(1)} > ${maxDistance})`
		// )
		return false
	}

	// УРОВЕНЬ 2: Raycast - прямая видимость (быстро)
	if (canSeeEnemy(bot, enemy)) {
		return true
	}

	// УРОВЕНЬ 3: Pathfinder - есть ли путь обхода? (медленно, с кешем)
	return await isEnemyReachable(bot, enemy, maxPathLength, pathfindTimeout)
}

/**
 * Очистка кеша pathfinder (вызывать периодически или при изменении мира)
 */
export function clearPathfindCache(): void {
	pathfindCache.clear()
	console.log('🧹 [clearPathfindCache] Кеш pathfinder очищен')
}

/**
 * Очистка устаревших записей из кеша
 * @param maxAge - Максимальный возраст записи в мс
 */
export function cleanupPathfindCache(maxAge: number = 5000): void {
	const now = Date.now()
	let cleaned = 0

	for (const [id, entry] of pathfindCache.entries()) {
		if (now - entry.timestamp > maxAge) {
			pathfindCache.delete(id)
			cleaned++
		}
	}

	if (cleaned > 0) {
		console.log(
			`🧹 [cleanupPathfindCache] Удалено ${cleaned} устаревших записей`
		)
	}
}
