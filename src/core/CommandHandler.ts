import Config, { type Config as ConfigInstance } from '@/config/config.js'
import logger from '@/config/logger.js'

import type { UserEvents } from '@/hsm/types.js'

import {
	AI_PILOT_UNAVAILABLE_COMMAND_MESSAGE,
	isAiPilotDisabled
} from '@/ai/pilotAvailability.js'

interface CommandBot {
	username: string
	chat(message: string): void
	on(
		event: 'chat',
		listener: (username: string, message: string) => void
	): unknown
	off(
		event: 'chat',
		listener: (username: string, message: string) => void
	): unknown
}

interface CommandEventTarget {
	send(event: UserEvents): void
}

export default class CommandHandler {
	private bot: CommandBot
	private hsm: CommandEventTarget
	private readonly onChat = (username: string, message: string) =>
		this.chat(username, message)
	private listening = false

	constructor(
		bot: CommandBot,
		hsm: CommandEventTarget,
		private readonly config: Pick<ConfigInstance, 'ai'> = Config
	) {
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
		if (isAiPilotDisabled(this.config.ai.provider)) {
			this.bot.chat(AI_PILOT_UNAVAILABLE_COMMAND_MESSAGE)
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
