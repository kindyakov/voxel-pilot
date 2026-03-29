import { plugin as toolPlugin } from 'mineflayer-tool'

import type { Bot } from '@/types'

export const loadTool = (bot: Bot): void => {
	bot.loadPlugin(toolPlugin)
}
