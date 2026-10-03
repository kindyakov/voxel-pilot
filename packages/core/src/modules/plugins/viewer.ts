import type { Bot } from '@/types/index.js'

export const initViewer = async (bot: Bot, port: number): Promise<void> => {
	const { mineflayer: mineFlayerViewer } = await import('prismarine-viewer')
	mineFlayerViewer(bot, {
		port,
		firstPerson: true
	})
}
