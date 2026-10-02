import pvpPackage from 'mineflayer-pvp'

import type { Bot } from '@/types/index.js'

export const loadPvp = (bot: Bot): void => {
	bot.loadPlugin(pvpPackage.plugin)
}
