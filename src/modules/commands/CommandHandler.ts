import logger from '../../config/logger.js'
import { commands } from './index.commands.js'

export class CommandHandler {
	constructor(bot, hsm) {
		this.bot = bot
		this.hsm = hsm
		this.init()
	}

	init() {
		if (!this.bot) {
			logger.error('Не обнаружен экземпляр бота')
			return
		}

		this.bot.on('chat', this.chat.bind(this))
	}

	chat(username, message) {
		if (username === this.bot.username) return

		const parsed = this.parseMessage(message)
		if (!parsed.length) return // не команда

		const [command, options] = parsed

		logger.playerCommand(username, command, options)

		if (commands[command]) {
			commands[command].execute(this.bot, { username, ...options })
		} else {
			this.hsm.emit('player-command', command, { username, ...options })
		}
	}

	parseMessage(msg = '') {
		if (!msg) return []
		let text = msg.trim()
		// Если сообщение пустое или не начинается на символ ":" то останавливаем код
		if (!text || !text.startsWith(':')) return []
		const [command, ...options] = text.slice(1).split(' ') // возвращает все после ":"
		return [command.toLocaleLowerCase(), options]
	}
}
