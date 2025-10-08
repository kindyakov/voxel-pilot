import 'dotenv/config'
import inventoryViewer from 'mineflayer-web-inventory'
import type { Bot } from '../../types'

export const loadWebInventory = (bot: Bot): void => {
	inventoryViewer(bot, {
		port: parseInt(process.env.MINECRAFT_WEB_INVENTORY_PORT || '3001', 10)
	})
}
