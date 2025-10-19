import type { MachineActionParams } from '@hsm/types'
import type { MiningTaskData } from '@hsm/tasks/types'

/**
 * Entry action для MINING с восстановлением прогресса
 */
const entryMining = ({ context }: MachineActionParams) => {
	const bot = context.bot
	if (!bot) {
		console.error('❌ [entryMining] Bot не инициализирован')
		return
	}

	console.log('🔨 [MINING] Вход в состояние MINING')
}

/**
 * Функция-ассайнер для восстановления прогресса MINING
 * Используется в machine.ts как: assign({ taskData: restoreMiningProgress })
 */
const restoreMiningProgress = ({ context }: MachineActionParams): MiningTaskData | null => {
	const bot = context.bot
	if (!bot) {
		console.warn('⚠️ [restoreMiningProgress] Bot не инициализирован')
		return context.taskData as MiningTaskData | null
	}

	const taskData = context.taskData as MiningTaskData
	if (!taskData) {
		console.warn('⚠️ [restoreMiningProgress] Нет taskData')
		return null
	}

	// Проверить восстановление прогресса из памяти
	const currentGoal = bot.memory.getMemory().goals.current

	if (currentGoal && currentGoal.progress?.type === 'MINING') {
		const savedProgress = currentGoal.progress

		console.log(
			`♻️ [MINING] Восстановление прогресса: ${savedProgress.collected || 0}/${taskData.count || 1}`
		)

		// Вернуть обновлённый taskData с восстановленным прогрессом
		return {
			...taskData,
			collected: savedProgress.collected || 0,
			navigationAttempts: savedProgress.navigationAttempts || 0
		} as MiningTaskData
	}

	console.log('🆕 [MINING] Начало новой задачи')
	return taskData
}

/**
 * Entry action для TASK_COMPLETED
 */
const taskMiningCompleted = ({ context }: MachineActionParams) => {
	const bot = context.bot
	if (!bot) {
		console.error('❌ [taskMiningCompleted] Bot не инициализирован')
		return
	}

	const taskData = context.taskData as MiningTaskData | null
	if (!taskData) {
		console.warn('⚠️ [taskMiningCompleted] Нет taskData')
		return
	}

	console.log(
		`✅ [MINING] Задача завершена: ${taskData.collected}/${taskData.count || 1}`
	)

	// Очистить context.taskData
	context.taskData = null

	// Завершить цель в памяти
	const currentGoal = bot.memory.getMemory().goals.current
	if (currentGoal) {
		bot.memory.completeCurrentGoal()
		console.log(
			`✅ [MINING] Цель "${currentGoal.goal}" добавлена в completed goals`
		)

		// Немедленное сохранение
		bot.memory.save().catch((err) => {
			console.error('❌ [taskMiningCompleted] Ошибка сохранения памяти:', err)
		})
	} else {
		console.warn('⚠️ [taskMiningCompleted] Нет текущей цели для завершения')
	}
}

/**
 * Entry action для TASK_FAILED
 */
const taskMiningFailed = ({ context }: MachineActionParams) => {
	const bot = context.bot
	if (!bot) {
		console.error('❌ [taskMiningFailed] Bot не инициализирован')
		return
	}

	const taskData = context.taskData as MiningTaskData | null
	console.log('❌ [MINING] Задача провалена!')

	// Очистить context.taskData
	context.taskData = null

	// Провалить цель в памяти
	const currentGoal = bot.memory.getMemory().goals.current
	if (currentGoal) {
		const reason = taskData
			? `Не удалось найти/добыть ${taskData.blockName}`
			: 'Неизвестная причина'

		bot.memory.failCurrentGoal(reason)
		console.log(`❌ [MINING] Цель "${currentGoal.goal}" добавлена в failed goals`)

		// Немедленное сохранение
		bot.memory.save().catch((err) => {
			console.error('❌ [taskMiningFailed] Ошибка сохранения памяти:', err)
		})
	} else {
		console.warn('⚠️ [taskMiningFailed] Нет текущей цели для провала')
	}
}

export default {
	entryMining,
	restoreMiningProgress,
	taskMiningCompleted,
	taskMiningFailed
}
