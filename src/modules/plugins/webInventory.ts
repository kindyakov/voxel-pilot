import inventoryViewer from 'mineflayer-web-inventory'

import type { Bot } from '@/types/index.js'

import Config from '@/config/config.js'

export const loadWebInventory = (bot: Bot): void => {
	inventoryViewer(bot, {
		port: Config.diagnostics.webInventoryPort
	})
}
