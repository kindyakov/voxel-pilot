import type { Bot } from '@/types'

import logger from '@/config/logger'

import type BotStateMachine from '@/core/hsm'

export default class CommandHandler {
	private bot: Bot
	private hsm: BotStateMachine
	private readonly onChat = (username: string, message: string) =>
		this.chat(username, message)
	private listening = false

	constructor(bot: Bot, hsm: BotStateMachine) {
		this.bot = bot
		this.hsm = hsm
		this.init()
	}

	init(): void {
		if (this.listening) return
		this.listening = true
		this.bot.on('chat', this.onChat)
	}

	stop(): void {
		if (!this.listening) return
		this.listening = false
		this.bot.off('chat', this.onChat)
	}

	chat(username: string, message: string): void {
		if (username === this.bot.username) return

		const text = message.trim()
		if (!text) return
		if (!text.startsWith(':')) return

		const commandText = text.slice(1).trim()
		if (!commandText) return

		if (commandText === 'stop') {
			logger.playerCommand(username, 'stop', [])
			this.hsm.send({
				type: 'STOP_CURRENT_GOAL',
				username
			})
			return
		}

		logger.playerCommand(username, 'goal', [commandText])
		this.hsm.send({
			type: 'USER_COMMAND',
			username,
			text: commandText
		})
	}
}
