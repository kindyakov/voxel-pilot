import pvpPackage from 'mineflayer-pvp'
import type { Bot } from '../../types'

export const loadPvp = (bot: Bot) => {
	bot.loadPlugin(pvpPackage.plugin)
}
