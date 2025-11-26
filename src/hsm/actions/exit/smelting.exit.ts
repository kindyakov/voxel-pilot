import type { MachineActionParams } from '@hsm/types'
import type { SmeltingTaskData } from '@hsm/tasks/types'

/**
 * Exit action для SMELTING
 */
const exitSmelting = ({ context }: MachineActionParams) => {
	const bot = context.bot
	if (!bot) {
		console.error('❌ [exitSmelting] Bot не инициализирован')
		return
	}

	console.log('⬅️ [SMELTING] Выход из состояния SMELTING')

	// Остановить pathfinder если он был запущен
	if (bot.pathfinder) {
		bot.pathfinder.setGoal(null)
		console.log('🛑 [SMELTING] Pathfinder остановлен')
	}
}

export default {
	exitSmelting
}
