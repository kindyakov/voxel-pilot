import type { MachineActionParams } from '@hsm/types'
import type { FarmingTaskData } from '@hsm/tasks/types'

/**
 * Exit action для FARMING
 */
const exitFarming = ({ context }: MachineActionParams) => {
	const bot = context.bot
	if (!bot) {
		console.error('❌ [exitFarming] Bot не инициализирован')
		return
	}

	console.log('⬅️ [FARMING] Выход из состояния FARMING')

	// Остановить pathfinder если он был запущен
	if (bot.pathfinder) {
		bot.pathfinder.setGoal(null)
		console.log('🛑 [FARMING] Pathfinder остановлен')
	}
}

export default {
	exitFarming
}
