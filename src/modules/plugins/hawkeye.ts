import minecraftHawkEye from 'minecrafthawkeye'
import type { Bot } from '../../types'

export const loadHawkeye = (bot: Bot) => {
	bot.loadPlugin(minecraftHawkEye.default)
}
