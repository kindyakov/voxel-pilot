import Logger from '../../config/logger'
import { loadPlugins, initPlugins } from '../plugins/index.plugins'
import type { Bot } from '../../types'

export const initConnection = (bot: Bot) => {
	try {
		loadPlugins(bot)

		bot.once('spawn', () => {
			initPlugins(bot)
			Logger.info('Бот заспавнился')
			bot.emit('botReady')
		})

		bot.on('end', reason => {
			Logger.warn(`Бот отключился: ${reason}`)
			bot.emit('botDisconnected', reason)
		})

		bot.on('error', err => {
			Logger.error('Ошибка бота:', err)
			bot.emit('botError', err)
		})
	} catch (error) {
		throw error
	}
}
