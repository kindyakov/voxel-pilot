import minecraftHawkEye from 'minecrafthawkeye'
import type { Bot } from '../../types'

export const loadHawkeye = (bot: Bot): void => {
	bot.loadPlugin(minecraftHawkEye)
}
