import type { MachineActionParams } from '@hsm/types'
import type { FollowingTaskData } from '@hsm/tasks/types'

/**
 * Exit action для FOLLOWING
 */
const exitFollowing = ({ context }: MachineActionParams) => {
	const bot = context.bot
	if (!bot) {
		console.error('❌ [exitFollowing] Bot не инициализирован')
		return
	}

	console.log('⬅️ [FOLLOWING] Выход из состояния FOLLOWING')

	// Остановить pathfinder
	if (bot.pathfinder) {
		bot.pathfinder.setGoal(null)
		console.log('🛑 [FOLLOWING] Pathfinder остановлен')
	}
}

/**
 * Exit action для FOLLOWING_TARGET
 */
const exitFollowingTarget = ({ context }: MachineActionParams) => {
	const bot = context.bot
	if (!bot) {
		console.error('❌ [exitFollowingTarget] Bot не инициализирован')
		return
	}

	// Остановить pathfinder при выходе из состояния следования
	if (bot.pathfinder) {
		bot.pathfinder.setGoal(null)
		console.log('🛑 [FOLLOWING_TARGET] Pathfinder остановлен')
	}
}

export default {
	exitFollowing,
	exitFollowingTarget
}
