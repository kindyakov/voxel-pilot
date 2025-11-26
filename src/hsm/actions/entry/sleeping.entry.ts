import type { MachineActionParams } from '@hsm/types'
import type { SleepingTaskData } from '@hsm/tasks/types'

/**
 * Entry action для SLEEPING
 */
const entrySleeping = ({ context }: MachineActionParams) => {
	const bot = context.bot
	if (!bot) {
		console.error('❌ [entrySleeping] Bot не инициализирован')
		return
	}

	console.log('😴 [SLEEPING] Вход в состояние SLEEPING')
}

/**
 * Entry action для SEARCHING_BED
 */
const entrySearchingBed = ({ context }: MachineActionParams) => {
	const bot = context.bot
	if (!bot) {
		console.error('❌ [entrySearchingBed] Bot не инициализирован')
		return
	}

	console.log('🔍 [SLEEPING] Поиск кровати...')
}

/**
 * Entry action для SLEEPING_IN_BED
 */
const entrySleepingInBed = ({ context }: MachineActionParams) => {
	const bot = context.bot
	if (!bot) {
		console.error('❌ [entrySleepingInBed] Bot не инициализирован')
		return
	}

	console.log('🛏️ [SLEEPING] Сон в кровати...')
}

/**
 * Entry action для TASK_COMPLETED
 */
const taskSleepingCompleted = ({ context }: MachineActionParams) => {
	const bot = context.bot
	if (!bot) {
		console.error('❌ [taskSleepingCompleted] Bot не инициализирован')
		return
	}

	console.log('✅ [SLEEPING] Задача завершена: сон завершен')

	// Очистить context.taskData
	context.taskData = null
}

/**
 * Entry action для TASK_FAILED
 */
const taskSleepingFailed = ({ context }: MachineActionParams) => {
	const bot = context.bot
	if (!bot) {
		console.error('❌ [taskSleepingFailed] Bot не инициализирован')
		return
	}

	console.log('❌ [SLEEPING] Задача провалена!')

	// Очистить context.taskData
	context.taskData = null
}

export default {
	entrySleeping,
	entrySearchingBed,
	entrySleepingInBed,
	taskSleepingCompleted,
	taskSleepingFailed
}
