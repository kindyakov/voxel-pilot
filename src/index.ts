import 'dotenv/config'

import Logger from '@config/logger'

import MinecraftBot from '@core/bot'

const minecraftBot = new MinecraftBot()
minecraftBot.start()

process.on('SIGINT', async () => {
	Logger.info('Остановка бота...')
	await minecraftBot.stop('Выключение сервера')
	process.exit()
})
