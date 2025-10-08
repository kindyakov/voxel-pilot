import logger from '@config/logger'
import type { Bot } from '@types'
import type BotStateMachine from '@core/hsm'

interface ParsedCommand {
	command: string
	args: string[]
}

export default class CommandHandler {
	private bot: Bot
	private hsm: BotStateMachine

	constructor(bot: Bot, hsm: BotStateMachine) {
		this.bot = bot
		this.hsm = hsm
		this.init()
	}

	init(): void {
		this.bot.on('chat', this.chat.bind(this))
	}

	chat(username: string, message: string): void {
		if (username === this.bot.username) return

		const parsed = this.parseMessage(message)
		if (!parsed) return // не команда

		const { command, args } = parsed

		logger.playerCommand(username, command, args)

		this.hsm.emit('player-command', command, { username, ...args })
	}

	parseMessage(msg: string): ParsedCommand | null {
		let text = msg.trim()
		if (!text || !text.startsWith(':')) return null
		const [command = '', ...args] = text.slice(1).split(' ') // возвращает все после ":"
		return {
			command: command.toLowerCase(),
			args
		}
	}
}
