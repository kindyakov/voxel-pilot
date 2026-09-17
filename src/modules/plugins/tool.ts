import { plugin as toolPlugin } from 'mineflayer-tool'

import type { Bot } from '@/types/index.js'

export const loadTool = (bot: Bot): void => {
	bot.loadPlugin(toolPlugin)
}
