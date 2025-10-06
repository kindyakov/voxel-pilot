import movement from 'mineflayer-movement'
import type { Bot } from '../../types'

export const loadMovement = (bot: Bot) => {
	bot.loadPlugin(movement.plugin)
}
