import armorManager from 'mineflayer-armor-manager'

import type { Bot } from '../../types'

export const loadArmorManager = (bot: Bot): void => {
	bot.loadPlugin(armorManager)
}

export const initArmorManager = (bot: Bot): void => {
	bot.armorManager.equipAll()
}
