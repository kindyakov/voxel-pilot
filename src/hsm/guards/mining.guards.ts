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
		console.log('⚠️ [hasRequiredTool] No taskData or blockName')
		return false
	}

	const { bot } = context
	if (!bot) return false

	// Получаем данные о блоке
	const blockData = bot.registry.blocksByName[taskData.blockName]

	if (!blockData) {
		console.log(`⚠️ [hasRequiredTool] Unknown block: ${taskData.blockName}`)
		return false
	}

	// Проверяем нужен ли инструмент вообще
	const harvestTools = blockData.harvestTools

	if (!harvestTools || Object.keys(harvestTools).length === 0) {
		// Блок можно добывать руками
		console.log(
			`✅ [hasRequiredTool] ${taskData.blockName} doesn't require tool`
		)
		return true
	}

	// Ищем подходящий инструмент в инвентаре
	const items = bot.inventory.items()
	const hasTool = items.some((item: any) => harvestTools[item.type] === true)

	if (hasTool) {
		console.log(
			`✅ [hasRequiredTool] Found suitable tool for ${taskData.blockName}`
		)
		return true
	}

	console.log(`❌ [hasRequiredTool] No suitable tool for ${taskData.blockName}`)
	console.log(`   Required tool IDs: ${Object.keys(harvestTools).join(', ')}`)

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
		console.log('❌ [hasInventorySpace] Inventory is full')
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

	const distance = bot.entity.position.distanceTo(taskData.targetBlock.position)

	// Досягаемость - примерно 4 блока
	const isNearby = distance <= 4

	if (isNearby) {
		console.log(`✅ [isBlockNearby] Block is nearby (${distance.toFixed(2)}m)`)
	}

	return isNearby
}

export default {
	hasRequiredTool,
	hasInventorySpace,
	isBlockNearby
}
