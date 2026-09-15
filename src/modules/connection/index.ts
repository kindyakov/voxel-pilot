import type { Bot } from '@/types'

import Logger from '@/config/logger'

import { initPlugins, loadPlugins } from '@/modules/plugins/index.plugins'

export const initConnection = (bot: Bot): (() => void) => {
	const onSpawn = () => {
		try {
			initPlugins(bot)
			Logger.info('Бот заспавнился')
			bot.emit('botReady')
		} catch (error) {
			bot.emit('botError', error)
		}
	}

	const onEnd = (reason: string) => {
		Logger.warn(`Бот отключился: ${reason}`)
		bot.emit('botDisconnected', reason)
	}

	const onError = (err: Error) => {
		Logger.error('Ошибка бота:', err)
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
