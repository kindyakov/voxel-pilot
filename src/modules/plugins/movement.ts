import movement from 'mineflayer-movement'

import type { Bot } from '@/types/index.js'

export const loadMovement = (bot: Bot): void => {
	bot.loadPlugin(movement.plugin)
}
