import EventEmitter from 'node:events'

import * as mineflayer from 'mineflayer'

import type { Bot } from '@/types/index.js'

import Config from '@/config/config.js'
import Logger from '@/config/logger.js'

import CommandHandler from '@/core/CommandHandler.js'
import BotStateMachine from '@/core/hsm.js'
import { MemoryManager } from '@/core/memory/index.js'
import { ProfileMemoryStore } from '@/core/profile/index.js'

import { isAiPilotDisabled } from '@/ai/pilotAvailability.js'

import { initConnection } from '@/modules/connection/index.js'

import { BotUtils } from '@/utils/minecraft/botUtils.js'

interface ConnectionDependencies {
	createBot: (options: typeof Config.minecraft) => Bot
	initConnection: (bot: Bot) => () => void
}

interface BotSession {
	bot: Bot
	hsm: BotStateMachine | null
	commands: CommandHandler | null
	connectionCleanup: (() => void) | null
	listeners: Array<() => void>
	saveTimer?: ReturnType<typeof setInterval>
	disposed: boolean
	disposal: Promise<void> | null
}

const defaultDependencies: ConnectionDependencies = {
	createBot: (
		mineflayer as unknown as {
			createBot: ConnectionDependencies['createBot']
		}
	).createBot,
	initConnection
}

class MinecraftBot extends EventEmitter {
	private readonly dependencies: ConnectionDependencies
	private session: BotSession | null = null
	private closing: Promise<void> | null = null
	private running = false
	private reconnectAttempts = 0
	private reconnectPausedGoal: string | null = null
	private reconnectTimer?: ReturnType<typeof setTimeout>
	private readonly maxReconnectAttempts = 5
	private readonly reconnectDelay = 3000

	constructor(dependencies: Partial<ConnectionDependencies> = {}) {
		super()
		this.dependencies = { ...defaultDependencies, ...dependencies }
	}

	start(): void {
		if (this.session) return
		this.running = true
		this.clearReconnect()
		this.connect()
	}

	private connect(): void {
		if (!this.running || this.session) return
		if (this.closing) {
			void this.closing.then(() => this.connect())
			return
		}
		try {
			Logger.info('Запуск бота...')
			Config.assertAIConfigured()
			const bot = this.dependencies.createBot(Config.minecraft)
			const session: BotSession = {
				bot,
				hsm: null,
				commands: null,
				connectionCleanup: null,
				listeners: [],
				disposed: false,
				disposal: null
			}
			this.session = session
			const onReady = () => {
				void this.initializeSession(session)
			}
			const onDisconnected = () => {
				if (this.session !== session) return
				void this.disposeSession(session, 'Соединение закрыто', false)
				this.scheduleReconnect()
			}
			const onError = (error: unknown) => this.failSession(session, error)
			bot.on('botReady', onReady)
			bot.on('botDisconnected', onDisconnected)
			bot.on('botError', onError)
			session.listeners.push(
				() => bot.off('botReady', onReady),
				() => bot.off('botDisconnected', onDisconnected),
				() => bot.off('botError', onError)
			)
			const cleanup = this.dependencies.initConnection(bot)
			if (session.disposed) cleanup()
			else session.connectionCleanup = cleanup
		} catch (error) {
			Logger.error('Ошибка запуска бота', { error: String(error) })
			if (this.session)
				void this.disposeSession(this.session, 'Ошибка запуска', true)
			this.scheduleReconnect()
		}
	}

	private async initializeSession(session: BotSession): Promise<void> {
		if (this.session !== session || session.disposed || session.hsm) return
		try {
			const bot = session.bot
			bot.utils = new BotUtils(bot)
			bot.memory = new MemoryManager({ botName: bot.username })
			bot.profileMemory = new ProfileMemoryStore({ botName: bot.username })
			const hsm = new BotStateMachine(bot, {
				pausedGoal: this.reconnectPausedGoal
			})
			session.hsm = hsm
			bot.hsm = hsm
			session.commands = new CommandHandler(bot, hsm)
			const ready = await hsm.ready
			if (this.session !== session || session.disposed) return
			if (!ready) {
				this.failSession(session, new Error('HSM initialization failed'))
				return
			}
			const shouldResumePausedGoal =
				this.reconnectPausedGoal !== null &&
				!isAiPilotDisabled(Config.ai.provider)
			this.reconnectPausedGoal = null
			if (shouldResumePausedGoal) hsm.resumePausedGoal()
			this.reconnectAttempts = 0
			session.saveTimer = setInterval(
				() => {
					void hsm.save()
				},
				5 * 60 * 1000
			)
			bot.chat('Я готов к работе ;)')
		} catch (error) {
			this.failSession(session, error)
		}
	}

	private failSession(session: BotSession, error: unknown): void {
		if (this.session !== session || session.disposed) return
		Logger.error('Ошибка сессии бота', { error: String(error) })
		void this.disposeSession(session, 'Ошибка сессии', true)
		this.scheduleReconnect()
	}

	private cleanup(action: () => void): void {
		try {
			action()
		} catch (error) {
			Logger.error('Ошибка очистки сессии', { error: String(error) })
		}
	}

	private disposeSession(
		session: BotSession,
		reason: string,
		disconnect: boolean
	): Promise<void> {
		if (session.disposal) return session.disposal
		session.disposed = true
		if (this.running && session.hsm) {
			const reconnectGoal = session.hsm.getReconnectGoal()
			if (reconnectGoal) this.reconnectPausedGoal = reconnectGoal
		}
		if (this.session === session) this.session = null
		if (session.saveTimer) clearInterval(session.saveTimer)
		for (const dispose of session.listeners.splice(0)) this.cleanup(dispose)
		this.cleanup(() => session.commands?.stop())
		let stopped: Promise<void> = Promise.resolve()
		this.cleanup(() => {
			stopped = session.hsm?.stop() ?? stopped
		})
		// Stop behavior before waiting for persistence or asking the connection to close.
		if (disconnect) this.cleanup(() => session.bot.quit(reason))
		this.cleanup(() => session.connectionCleanup?.())
		session.connectionCleanup = null
		const disposal = stopped
			.catch(error => {
				Logger.error('Ошибка остановки HSM', { error: String(error) })
			})
			.finally(() => {
				if (this.closing === disposal) this.closing = null
			})
		this.closing = disposal
		session.disposal = disposal
		return session.disposal
	}

	stop(reason: string = 'Бот остановлен вручную.'): Promise<void> {
		this.running = false
		this.reconnectPausedGoal = null
		this.clearReconnect()
		this.reconnectAttempts = 0
		return this.session
			? this.disposeSession(this.session, reason, true)
			: (this.closing ?? Promise.resolve())
	}

	private clearReconnect(): void {
		if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
		this.reconnectTimer = undefined
	}

	private scheduleReconnect(): void {
		if (!this.running || this.reconnectTimer || this.session) return
		if (this.reconnectAttempts >= this.maxReconnectAttempts) {
			Logger.error(
				'Превышено число попыток реконнекта. Бот больше не подключается.'
			)
			return
		}
		const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts++)
		Logger.info(`Попытка реконнекта через ${delay / 1000} секунд...`)
		this.reconnectTimer = setTimeout(() => {
			this.reconnectTimer = undefined
			this.connect()
		}, delay)
	}
}

export default MinecraftBot
