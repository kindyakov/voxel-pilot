import { mineflayer as mineFlayerViewer } from 'prismarine-viewer'

import type { Bot } from '@/types/index.js'

import Config from '@/config/config.js'

export const initViewer = (bot: Bot): void => {
	mineFlayerViewer(bot, {
		port: Config.diagnostics.viewerPort,
		firstPerson: true
	})
}
