import 'dotenv/config'
import MinecraftBot from '@core/bot'
import Logger from '@config/logger'

const minecraftBot = new MinecraftBot()
minecraftBot.start()

process.on('SIGINT', async () => {
	Logger.info('Остановка бота...')
	await minecraftBot.stop('Выключение сервера')
	process.exit()
})
