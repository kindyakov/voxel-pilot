import type { MachineActionParams } from '@hsm/types'
import type { CraftingTaskData } from '@hsm/tasks/types'

/**
 * Exit action для CRAFTING
 */
const exitCrafting = ({ context }: MachineActionParams) => {
	const bot = context.bot
	if (!bot) {
		console.error('❌ [exitCrafting] Bot не инициализирован')
		return
	}

	console.log('⬅️ [CRAFTING] Выход из состояния CRAFTING')
}

export default {
	exitCrafting
}
