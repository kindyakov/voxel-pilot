import type { Bot } from '@/types/index.js'

import type { RuntimeLogger } from '@/config/runtimeLogger.js'

import { initPlugins, loadPlugins } from '@/modules/plugins/index.plugins.js'

export const createConnectionInitializer =
	(logger: RuntimeLogger) =>
	(bot: Bot): (() => void) => {
		const onSpawn = () => {
			try {
				initPlugins(bot)
				logger.info('Бот заспавнился')
				bot.emit('botReady')
			} catch (error) {
				bot.emit('botError', error)
			}
		}

		const onEnd = (reason: string) => {
			logger.warn(`Бот отключился: ${reason}`)
			bot.emit('botDisconnected', reason)
		}

		const onError = (err: Error) => {
			logger.error('Ошибка бота:', err)
			bot.emit('botError', err)
		}
		const dispose = () => {
			bot.off('spawn', onSpawn)
			bot.off('end', onEnd)
			bot.off('error', onError)
		}
		bot.once('spawn', onSpawn)
		bot.on('end', onEnd)
		bot.on('error', onError)
		try {
			loadPlugins(bot)
		} catch (error) {
			dispose()
			throw error
		}
		return dispose
	}
