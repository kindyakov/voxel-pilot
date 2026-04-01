import Logger from '../../config/logger'
import type { Bot } from '../../types'
import { initPlugins, loadPlugins } from '../plugins/index.plugins'

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
