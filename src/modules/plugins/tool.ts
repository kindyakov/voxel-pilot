import toolPlugin from 'mineflayer-tool'
import type { Bot } from '../../types'

export const loadTool = (bot: bot) => {
  bot.loadPlugin(toolPlugin)
}