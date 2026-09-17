import 'dotenv/config'

import Logger from '@/config/logger.js'

import MinecraftBot from '@/core/bot.js'

const minecraftBot = new MinecraftBot()
minecraftBot.start()

const shutdown = async (): Promise<void> => {
	Logger.info('Остановка бота...')
	await minecraftBot.stop('Выключение сервера')
	process.exit()
}

process.on('SIGINT', () => {
	void shutdown()
})
process.on('SIGTERM', () => {
	void shutdown()
})
