import { createCliRuntime } from './bootstrap.js'

const { runtime, loggerHandle } = createCliRuntime()
let closing: Promise<void> | undefined

const shutdown = (): Promise<void> => {
	if (closing) return closing
	closing = (async () => {
		loggerHandle.logger.info('Остановка бота...')
		try {
			await runtime.stop('Выключение сервера')
		} finally {
			try {
				await loggerHandle.close()
			} finally {
				process.off('SIGINT', onSignal)
				process.off('SIGTERM', onSignal)
			}
		}
		process.exit()
	})()
	return closing
}

const onSignal = () => {
	void shutdown().catch(error => {
		console.error(
			'Ошибка остановки приложения',
			error instanceof Error ? error.message : String(error)
		)
		process.exitCode = 1
	})
}
process.on('SIGINT', onSignal)
process.on('SIGTERM', onSignal)
runtime.start()
