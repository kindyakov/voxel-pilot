import type { MachineActionParams } from '@hsm/types'
import type { SmeltingTaskData } from '@hsm/tasks/types'

/**
 * Entry action для SMELTING
 */
const entrySmelting = ({ context }: MachineActionParams) => {
	const bot = context.bot
	if (!bot) {
		console.error('❌ [entrySmelting] Bot не инициализирован')
		return
	}

	const taskData = context.taskData as SmeltingTaskData
	console.log(`🔥 [SMELTING] Вход в состояние SMELTING: плавка ${taskData.inputItem} x${taskData.count}`)
}

/**
 * Entry action для CHECKING_PRECONDITIONS
 */
const entryCheckingSmeltingPreconditions = ({ context }: MachineActionParams) => {
	const bot = context.bot
	if (!bot) {
		console.error('❌ [entryCheckingSmeltingPreconditions] Bot не инициализирован')
		return
	}

	const taskData = context.taskData as SmeltingTaskData
	console.log(`🔍 [SMELTING] Проверка предусловий для плавки ${taskData.inputItem}`)
}

/**
 * Entry action для SEARCHING_FURNACE
 */
const entrySearchingFurnace = ({ context }: MachineActionParams) => {
	const bot = context.bot
	if (!bot) {
		console.error('❌ [entrySearchingFurnace] Bot не инициализирован')
		return
	}

	console.log('🔍 [SMELTING] Поиск печи...')
}

/**
 * Entry action для NAVIGATING
 */
const entrySmeltingNavigating = ({ context }: MachineActionParams) => {
	const bot = context.bot
	if (!bot) {
		console.error('❌ [entrySmeltingNavigating] Bot не инициализирован')
		return
	}

	console.log('🚶 [SMELTING] Навигация к печи...')
}

/**
 * Entry action для TASK_COMPLETED
 */
const taskSmeltingCompleted = ({ context }: MachineActionParams) => {
	const bot = context.bot
	if (!bot) {
		console.error('❌ [taskSmeltingCompleted] Bot не инициализирован')
		return
	}

	const taskData = context.taskData as SmeltingTaskData | null
	if (!taskData) {
		console.warn('⚠️ [taskSmeltingCompleted] Нет taskData')
		return
	}

	console.log(
		`✅ [SMELTING] Задача завершена: сплавлено ${taskData.smelted}/${taskData.count}`
	)

	// Очистить context.taskData
	context.taskData = null
}

/**
 * Entry action для TASK_FAILED
 */
const taskSmeltingFailed = ({ context }: MachineActionParams) => {
	const bot = context.bot
	if (!bot) {
		console.error('❌ [taskSmeltingFailed] Bot не инициализирован')
		return
	}

	const taskData = context.taskData as SmeltingTaskData | null
	console.log('❌ [SMELTING] Задача провалена!')

	// Очистить context.taskData
	context.taskData = null
}

export default {
	entrySmelting,
	entryCheckingSmeltingPreconditions,
	entrySearchingFurnace,
	entrySmeltingNavigating,
	taskSmeltingCompleted,
	taskSmeltingFailed
}
