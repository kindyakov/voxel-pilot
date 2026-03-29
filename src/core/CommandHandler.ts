import type { Bot } from '@/types'

import logger from '@/config/logger'

import type BotStateMachine from '@/core/hsm'

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

		const text = message.trim()
		if (!text) return

		if (text === ':stop') {
			logger.playerCommand(username, 'stop', [])
			this.hsm.send({
				type: 'STOP_CURRENT_GOAL',
				username
			})
			return
		}

		logger.playerCommand(username, 'goal', [text])
		this.hsm.send({
			type: 'USER_COMMAND',
			username,
			text
		})
	}
}
