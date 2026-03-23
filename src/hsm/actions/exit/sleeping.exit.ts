import type { SleepingTaskData } from '@hsm/tasks/types'
import type { MachineActionParams } from '@hsm/types'

/**
 * Exit action для SLEEPING
 */
const exitSleeping = ({ context }: MachineActionParams) => {
	const bot = context.bot
	if (!bot) {
		console.error('❌ [exitSleeping] Bot не инициализирован')
		return
	}

	console.log('⬅️ [SLEEPING] Выход из состояния SLEEPING')

	// Остановить pathfinder если он был запущен
	if (bot.pathfinder) {
		bot.pathfinder.setGoal(null)
		console.log('🛑 [SLEEPING] Pathfinder остановлен')
	}
}

export default {
	exitSleeping
}
