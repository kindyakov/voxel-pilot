import EventEmitter from 'node:events'
import mineflayer from 'mineflayer'
import type { Bot } from '@types'
import BotStateMachine from '@core/hsm'
import CommandHandler from '@core/commandHandler.js'
import Config from '@config/config'
import Logger from '@config/logger'
import { initConnection } from '@modules/connection/index.js'
import { BotUtils } from '@utils/minecraft/botUtils'

class MinecraftBot extends EventEmitter {
	private bot: Bot | null = null
	private isConnected: boolean = false
	private reconnectAttempts: number = 0
	private readonly maxReconnectAttempts: number = 5
	private readonly reconnectDelay: number = 3000

	constructor() {
		super()
	}

	start(): void {
		try {
			Logger.info('Запуск бота...')

			if (this.bot) {
				Logger.warn('Бот уже запущен!')
				return
			}

			// @ts-expect-error - Type augmentation issue with mineflayer
			this.bot = mineflayer.createBot(Config.minecraft) as Bot

			if (!this.bot) {
				throw Error('Не предвиденная ошибка при создании бота')
			}

			this.bot.on('botReady', () => {
				this.isConnected = true
				this.reconnectAttempts = 0

				if (!this.bot) return

				this.bot.utils = new BotUtils(this.bot)
				const hsm = new BotStateMachine(this.bot)
				new CommandHandler(this.bot, hsm)

				this.bot.chat('Я готов к работе ;)')
			})

			this.bot.on('botDisconnected', (reason: string) => {
				this.isConnected = false
				this.bot = null
				this.scheduleReconnect()
			})

			initConnection(this.bot)
		} catch (error) {
			const errorMessage =
				error instanceof Error ? error.message : String(error)

			Logger.error('Ошибка запуска бота:', {
				error: errorMessage,
				stack: error instanceof Error ? error.stack : undefined
			})

			this.isConnected = false
			this.bot = null
			this.scheduleReconnect()
		}
	}

	stop(reason: string = 'Бот остановлен вручную.'): void {
		if (!this.bot) {
			Logger.warn('Попытка остановить бота, который не был запущен.')
			return
		}
		this.isConnected = false
		Logger.info('Отключение бота...')
		this.bot.quit(reason)
		this.bot = null
	}

	scheduleReconnect(): void {
		if (this.reconnectAttempts >= this.maxReconnectAttempts) {
			Logger.error(
				'Превышено число попыток реконнекта. Бот больше не подключается.'
			)
			return
		}

		const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts)
		Logger.info(`Попытка реконнекта через ${delay / 1000} секунд...`)

		this.reconnectAttempts++
		setTimeout(() => this.start(), delay)
	}
}

export default MinecraftBot
