import type { Bot } from '@/types/index.js'

export const loadWebInventory = async (
	bot: Bot,
	port: number
): Promise<void> => {
	const { default: inventoryViewer } = await import('mineflayer-web-inventory')
	inventoryViewer(bot, {
		port
	})
}
