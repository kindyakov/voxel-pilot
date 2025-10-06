import { loader as autoEat } from 'mineflayer-auto-eat'
import type { Bot } from '../../types'

export const loadAutoEat = (bot: Bot) => {
	bot.loadPlugin(autoEat)
}

export const initAutoEat = (bot: Bot) => {
	// bot.autoEat.enableAuto()
	bot.autoEat.setOpts({
		eatingTimeout: 10000,
		strictErrors: false, // Логирование вместо исключений
		// equipOldItem: true, // вернуть предмет после еды
		priority: 'saturation', // бот выбирает еду, которая даёт максимальное насыщение
		offhand: false // бот будет использовать вторую руку
	})
}
