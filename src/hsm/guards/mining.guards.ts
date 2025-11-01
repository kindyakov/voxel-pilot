import type { MachineContext } from '@hsm/context'
import type { MiningTaskData } from '@hsm/tasks/types'

/**
 * Проверяет наличие подходящего инструмента для добычи блока
 */
export const hasRequiredTool = ({
	context
}: {
	context: MachineContext
}): boolean => {
	const taskData = context.taskData as MiningTaskData | null

	if (!taskData || !taskData.blockName) {
		console.log('⚠️ [hasRequiredTool] Нет taskData или blockName')
		return false
	}

	const { bot } = context
	if (!bot) return false

	// Получаем данные о блоке
	const blockData = bot.registry.blocksByName[taskData.blockName]

	if (!blockData) {
		console.log(`⚠️ [hasRequiredTool] Неизвестный блок: ${taskData.blockName}`)
		return false
	}

	// Проверяем нужен ли инструмент вообще
	const harvestTools = blockData.harvestTools

	if (!harvestTools || Object.keys(harvestTools).length === 0) {
		// Блок можно добывать руками
		console.log(
			`✅ [hasRequiredTool] ${taskData.blockName} не требует использования инструмента`
		)
		return true
	}

	// Ищем подходящий инструмент в инвентаре
	const items = bot.inventory.items()
	const hasTool = items.some((item: any) => harvestTools[item.type] === true)

	if (hasTool) {
		console.log(
			`✅ [hasRequiredTool] Найден подходящий инструмент для ${taskData.blockName}`
		)
		return true
	}

	console.log(
		`❌ [hasRequiredTool] Нет подходящего инструмента для ${taskData.blockName}`
	)
	console.log(
		`  Необходимые инструмент IDs: ${Object.keys(harvestTools).join(', ')}`
	)

	return false
}

/**
 * Проверяет есть ли место в инвентаре
 */
export const hasInventorySpace = ({
	context
}: {
	context: MachineContext
}): boolean => {
	const { bot } = context
	if (!bot) return false

	const hasSpace = bot.utils.hasInventorySpace()

	if (!hasSpace) {
		console.log('❌ [hasInventorySpace] Инвентарь полон')
	}

	return hasSpace
}

/**
 * Проверяет что блок находится в пределах досягаемости (не нужна навигация)
 */
export const isBlockNearby = ({
	context
}: {
	context: MachineContext
}): boolean => {
	const taskData = context.taskData as MiningTaskData | null

	if (!taskData || !taskData.targetBlock) {
		return false
	}

	const { bot } = context
	if (!bot) return false

	const blockPos = taskData.targetBlock.position
	const botPos = bot.entity.position

	const distanceXZ = Math.sqrt(
		Math.pow(blockPos.x - botPos.x, 2) + Math.pow(blockPos.z - botPos.z, 2)
	)
	const distanceY = Math.abs(blockPos.y - botPos.y)

	// Правила досягаемости:
	// - Y+1 (над головой) и XZ <= 3 - NEARBY (можно добыть без навигации)
	// - Y (на уровне) и XZ <= 4 - NEARBY
	// - Y-1 (под ногами) и XZ <= 4 - NEARBY
	// - Остальные - далеко

	let isNearby = false

	if (distanceY === 1 && distanceXZ <= 3) {
		// Y+1 и близко по XZ
		isNearby = true
	} else if (distanceY === 0 && distanceXZ <= 4) {
		// На том же уровне
		isNearby = true
	} else if (distanceY === 1 && blockPos.y < botPos.y && distanceXZ <= 4) {
		// Y-1 (под ногами)
		isNearby = true
	}

	if (isNearby) {
		console.log(
			`✅ [isBlockNearby] Блок находится рядом (XZ: ${distanceXZ.toFixed(2)}m, Y: ${distanceY})`
		)
	} else {
		console.log(
			`❌ [isBlockNearby] Блок находится далеко (XZ: ${distanceXZ.toFixed(2)}m, Y: ${distanceY})`
		)
	}

	return isNearby
}

export default {
	hasRequiredTool,
	hasInventorySpace,
	isBlockNearby
}
