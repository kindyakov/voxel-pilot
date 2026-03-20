import type { Bot, Vec3, Block } from '@/types'

/**
 * Информация об анализированном блоке
 */
export interface AnalyzedBlock {
	block: Block
	position: Vec3
	distanceHorizontal: number
	distanceTotal: number
	yDiff: number
}

/**
 * Результат проверки безопасности блока (базовая)
 */
export interface BlockSafetyCheck {
	isSafe: boolean
	reason?: string
}

/**
 * Детальный анализ безопасности блока
 */
interface BlockSafetyAnalysis {
	safetyScore: number // 0-100 (100 = максимально безопасно)
	positionType: 'floor' | 'wall' | 'ceiling' | 'unknown'
	hasGroundBelow: boolean
	depthBelow: number // сколько блоков воздуха вниз
	dangerousNearby: string[] // ['lava', 'water', 'void']
	itemDropSafe: boolean // безопасно ли выпадет предмет
	accessible: boolean // можно ли подойти
}

/**
 * Вычисляет бонус за высоту блока относительно бота
 *
 * @param yDiff - разница по Y (block.y - bot.y)
 * @returns бонус (больше = лучше)
 */
export function getYBonus(yDiff: number): number {
	if (yDiff === 1) return 40 // Y+1 (над головой) - большой бонус
	if (yDiff === 0) return 30 // Y (на уровне головы) - средний бонус
	if (yDiff === -1) return 10 // Y-1 (под ногами) - малый бонус
	return 0 // Остальные высоты - без бонуса
}

/**
 * Вычисляет штраф за расстояние до блока
 *
 * @param distance - расстояние в блоках
 * @returns штраф (больше = хуже)
 */
export function getDistancePenalty(distance: number): number {
	return distance * 2 // Каждый метр = -2 балла
}

/**
 * Вычисляет итоговую оценку блока (score)
 *
 * @param analyzedBlock - анализированный блок
 * @returns оценка (больше = лучше)
 */
export function calculateBlockScore(analyzedBlock: AnalyzedBlock): number {
	const bonus = getYBonus(analyzedBlock.yDiff)
	const penalty = getDistancePenalty(analyzedBlock.distanceTotal)
	return bonus - penalty
}

/**
 * Проверяет безопасность блока для добычи (базовая проверка)
 *
 * @param bot - экземпляр бота
 * @param blockPosition - позиция проверяемого блока
 * @returns результат проверки
 */
export function checkBlockSafety(
	bot: Bot,
	blockPosition: Vec3
): BlockSafetyCheck {
	// Проверяем блок под целевым
	const blockBelow = bot.blockAt(blockPosition.offset(0, -1, 0))

	if (!blockBelow) {
		return {
			isSafe: false,
			reason: 'Нет блока под целью (не загружен или край мира)'
		}
	}

	// Проверка на лаву
	if (blockBelow.name === 'lava') {
		return {
			isSafe: false,
			reason: 'Лава под блоком'
		}
	}

	// Проверка глубины пропасти
	if (blockBelow.name === 'air') {
		let depthBelow = 1
		for (let y = 2; y <= 10; y++) {
			const checkBlock = bot.blockAt(blockPosition.offset(0, -y, 0))
			if (checkBlock && checkBlock.name !== 'air') {
				break
			}
			depthBelow++
		}

		if (depthBelow >= 6) {
			return {
				isSafe: false,
				reason: `Глубокая пропасть (${depthBelow} блоков)`
			}
		}
	}

	return { isSafe: true }
}

/**
 * Детальный анализ безопасности блока с оценкой (0-100)
 *
 * @param bot - экземпляр бота
 * @param block - целевой блок
 * @param botPos - позиция бота
 * @returns детальный анализ безопасности
 */
export function analyzeBlockSafety(
	bot: Bot,
	block: Block,
	botPos: Vec3
): BlockSafetyAnalysis {
	let safetyScore = 100
	const dangers: string[] = []

	// 1. Определяем тип позиции блока
	const blockAbove = bot.blockAt(block.position.offset(0, 1, 0))
	const blockBelow = bot.blockAt(block.position.offset(0, -1, 0))

	let positionType: 'floor' | 'wall' | 'ceiling' | 'unknown' = 'unknown'

	if (!blockBelow || blockBelow.name === 'air') {
		positionType = 'floor' // Блок на полу (ничего под ним)
	} else if (!blockAbove || blockAbove.name === 'air') {
		positionType = 'ceiling' // Блок на потолке (ничего над ним)
	} else {
		positionType = 'wall' // Блок в стене (блоки со всех сторон)
	}

	// 2. Проверяем наличие земли под блоком
	const hasGroundBelow = blockBelow?.name !== 'air'
	if (!hasGroundBelow) {
		safetyScore -= 30 // Нет земли под блоком
	}

	// 3. Проверяем глубину пропасти
	let depthBelow = 0
	if (!hasGroundBelow && blockBelow) {
		for (let y = 1; y <= 10; y++) {
			const checkBlock = bot.blockAt(block.position.offset(0, -y, 0))
			if (!checkBlock || checkBlock.name === 'air') {
				depthBelow++
			} else {
				break
			}
		}
		if (depthBelow > 3) {
			safetyScore -= 40 // Глубокая пропасть
			dangers.push('void')
		}
	}

	// 4. Проверяем опасности в радиусе 2 блоков (3×3×3)
	const dangerousBlocks = new Set<string>()
	for (let x = -2; x <= 2; x++) {
		for (let y = -2; y <= 2; y++) {
			for (let z = -2; z <= 2; z++) {
				const checkPos = block.position.offset(x, y, z)
				const checkBlock = bot.blockAt(checkPos)

				if (checkBlock) {
					if (checkBlock.name === 'lava') {
						dangerousBlocks.add('lava')
						safetyScore -= 50
					} else if (checkBlock.name === 'water') {
						dangerousBlocks.add('water')
						safetyScore -= 20
					}
				}
			}
		}
	}
	dangers.push(...Array.from(dangerousBlocks))

	// 5. Оцениваем тип позиции
	if (positionType === 'ceiling') {
		safetyScore -= 25 // Опасно копать потолок
	} else if (positionType === 'wall') {
		safetyScore -= 10 // Средний риск
	}

	// 6. Проверяем доступность (упрощённая - по расстоянию)
	const distance = botPos.distanceTo(block.position)
	const accessible = distance < 50 // Если далеко - может быть недоступно

	if (!accessible) {
		safetyScore -= 20
	}

	// 7. Оцениваем безопасность выпадения предмета
	const itemDropSafe =
		hasGroundBelow && !dangers.includes('lava') && !dangers.includes('void')

	if (!itemDropSafe) {
		safetyScore -= 30
	}

	return {
		safetyScore: Math.max(0, safetyScore),
		positionType,
		hasGroundBelow,
		depthBelow,
		dangerousNearby: dangers,
		itemDropSafe,
		accessible
	}
}

/**
 * Проверяет, является ли блок тем, на котором стоит бот
 * (блок прямо под ногами)
 *
 * @param bot - экземпляр бота
 * @param blockPosition - позиция проверяемого блока
 * @returns true если блок под ногами бота
 */
export function isBlockDirectlyBelowBot(
	bot: Bot,
	blockPosition: Vec3
): boolean {
	const botPos = bot.entity.position

	return (
		blockPosition.y === Math.floor(botPos.y - 1) &&
		Math.abs(blockPosition.x - Math.floor(botPos.x)) < 1 &&
		Math.abs(blockPosition.z - Math.floor(botPos.z)) < 1
	)
}

/**
 * Форматирует yDiff для логирования
 *
 * @param yDiff - разница по Y
 * @returns строка для отображения
 */
export function formatYDiff(yDiff: number): string {
	if (yDiff === 1) return 'Y+1 ⭐'
	if (yDiff === 0) return 'Y='
	if (yDiff === -1) return 'Y-1'
	return `Y${yDiff > 0 ? '+' : ''}${yDiff}`
}
