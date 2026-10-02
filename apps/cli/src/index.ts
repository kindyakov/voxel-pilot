import { MinecraftBot } from '@voxel-pilot/core'
import Logger from '@voxel-pilot/core/legacy-logger'

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
