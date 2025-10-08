import 'dotenv/config'
import { mineflayer as mineFlayerViewer } from 'prismarine-viewer'
import type { Bot } from '../../types'

export const initViewer = (bot: Bot): void => {
	mineFlayerViewer(bot, {
		port: parseInt(process.env.MINECRAFT_VIEWER_PORT || '3000', 10),
		firstPerson: true
	})
}
