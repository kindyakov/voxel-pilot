import type { MachineActionParams } from '@hsm/types'
import type { MiningTaskData } from '@hsm/tasks/types'

/**
 * Exit action для MINING с сохранением прогресса
 */
const exitMining = ({ context }: MachineActionParams) => {
	const bot = context.bot
	if (!bot) {
		console.error('❌ [exitMining] Bot не инициализирован')
		return
	}

	console.log('⬅️ [MINING] Выход из состояния MINING')

	const taskData = context.taskData as MiningTaskData | null
	if (!taskData) {
		console.log('⚠️ [MINING] Нет taskData для сохранения')
		return
	}

	// Проверить завершена ли задача
	const isCompleted = (taskData.collected || 0) >= (taskData.count || 1)

	if (isCompleted) {
		console.log('✅ [MINING] Задача завершена, пропускаем сохранение прогресса')
		return
	}

	// Сохранить прогресс в memory.goals.current
	const progress = {
		type: 'MINING',
		collected: taskData.collected || 0,
		navigationAttempts: taskData.navigationAttempts || 0,
		timestamp: new Date().toISOString()
	}

	// console.log(
	// 	`💾 [MINING] Прогресс сохранён: ${progress.collected}/${taskData.count || 1}`
	// )

	// // Обновить current goal с прогрессом
	// const currentGoal = bot.memory.getMemory().goals.current

	// if (currentGoal) {
	// 	// Обновляем существующую цель
	// 	bot.memory.setCurrentGoal({
	// 		...currentGoal,
	// 		progress
	// 	})
	// } else {
	// 	// Создаём новую цель с прогрессом
	// 	bot.memory.setCurrentGoal({
	// 		goal: `MINING ${taskData.blockName}`,
	// 		priority: 6,
	// 		startedAt: new Date().toISOString(),
	// 		tasks: [
	// 			{
	// 				type: 'MINING',
	// 				params: {
	// 					blockName: taskData.blockName,
	// 					count: taskData.count
	// 				}
	// 			}
	// 		],
	// 		currentTaskIndex: 0,
	// 		progress
	// 	})
	// }

	// // Немедленное сохранение (не блокирующее)
	// bot.memory.save().catch(err => {
	// 	console.error('❌ [exitMining] Ошибка сохранения памяти:', err)
	// })
}

export default {
	exitMining
}
