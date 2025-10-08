import movement from 'mineflayer-movement'
import type { Bot } from '../../types'

export const loadMovement = (bot: Bot): void => {
	bot.loadPlugin(movement.plugin)
}
