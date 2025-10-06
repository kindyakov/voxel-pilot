import armorManager from 'mineflayer-armor-manager'
import type { Bot } from '../../types'

export const loadArmorManager = (bot: Bot) => {
	bot.loadPlugin(armorManager)
}

export const initArmorManager = (bot: Bot) => {
	bot.armorManager.equipAll()
}
