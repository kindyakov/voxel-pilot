import 'dotenv/config'
import inventoryViewer from 'mineflayer-web-inventory'
import type { Bot } from '../../types'

export const loadWebInventory = (bot: Bot) => {
	inventoryViewer(bot, {
		port: process.env.MINECRAFT_WEB_INVENTORY_PORT || 3001
	})
}
