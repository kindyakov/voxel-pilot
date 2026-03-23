import type { FarmingTaskData } from '@hsm/tasks/types'
import type { MachineActionParams } from '@hsm/types'

/**
 * Entry action для FARMING
 */
const entryFarming = ({ context }: MachineActionParams) => {
	const bot = context.bot
	if (!bot) {
		console.error('❌ [entryFarming] Bot не инициализирован')
		return
	}

	const taskData = context.taskData as FarmingTaskData
	console.log(
		`🌾 [FARMING] Вход в состояние FARMING: сбор ${taskData.cropName}`
	)
}

/**
 * Entry action для SEARCHING_CROP
 */
const entrySearchingCrop = ({ context }: MachineActionParams) => {
	const bot = context.bot
	if (!bot) {
		console.error('❌ [entrySearchingCrop] Bot не инициализирован')
		return
	}

	const taskData = context.taskData as FarmingTaskData
	console.log(`🔍 [FARMING] Поиск созревших культур: ${taskData.cropName}`)
}

/**
 * Entry action для HARVESTING
 */
const entryHarvesting = ({ context }: MachineActionParams) => {
	const bot = context.bot
	if (!bot) {
		console.error('❌ [entryHarvesting] Bot не инициализирован')
		return
	}

	console.log('🌾 [FARMING] Сбор урожая...')
}

/**
 * Entry action для TASK_COMPLETED
 */
const taskFarmingCompleted = ({ context }: MachineActionParams) => {
	const bot = context.bot
	if (!bot) {
		console.error('❌ [taskFarmingCompleted] Bot не инициализирован')
		return
	}

	const taskData = context.taskData as FarmingTaskData | null
	if (!taskData) {
		console.warn('⚠️ [taskFarmingCompleted] Нет taskData')
		return
	}

	console.log(
		`✅ [FARMING] Задача завершена: собрано ${taskData.collected}/${taskData.count || 1}`
	)

	// Очистить context.taskData
	context.taskData = null
}

/**
 * Entry action для TASK_FAILED
 */
const taskFarmingFailed = ({ context }: MachineActionParams) => {
	const bot = context.bot
	if (!bot) {
		console.error('❌ [taskFarmingFailed] Bot не инициализирован')
		return
	}

	console.log('❌ [FARMING] Задача провалена!')

	// Очистить context.taskData
	context.taskData = null
}

export default {
	entryFarming,
	entrySearchingCrop,
	entryHarvesting,
	taskFarmingCompleted,
	taskFarmingFailed
}
