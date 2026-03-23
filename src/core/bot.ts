import EventEmitter from 'node:events'

import * as mineflayer from 'mineflayer'

import type { Bot } from '@types'

import Config from '@config/config'
import Logger from '@config/logger'

import CommandHandler from '@core/CommandHandler.js'
import BotStateMachine from '@core/hsm'
import { MemoryManager } from '@core/memory/index.js'

import { initConnection } from '@modules/connection/index.js'

import { BotUtils } from '@utils/minecraft/botUtils'

const createMineflayerBot = (
	mineflayer as unknown as {
		createBot: (options: unknown) => Bot
	}
).createBot

class MinecraftBot extends EventEmitter {
	private bot: Bot | null = null
	private isConnected = false
	private reconnectAttempts = 0
	private readonly maxReconnectAttempts = 5
	private readonly reconnectDelay = 3000

	start(): void {
		try {
			Logger.info('Запуск бота...')
			Config.assertAIConfigured()

			if (this.bot) {
				Logger.warn('Бот уже запущен!')
				return
			}

			this.bot = createMineflayerBot(Config.minecraft)

			this.bot.on('botReady', () => {
				this.isConnected = true
				this.reconnectAttempts = 0

				if (!this.bot) {
					return
				}

				this.bot.utils = new BotUtils(this.bot)
				this.bot.memory = new MemoryManager({
					botName: this.bot.username
				}) as any
				this.bot.hsm = new BotStateMachine(this.bot)
				new CommandHandler(this.bot, this.bot.hsm)

				setInterval(
					() => {
						void this.bot!.memory.save()
					},
					5 * 60 * 1000
				)

				this.bot.chat('Я готов к работе ;)')
			})

			this.bot.on('botDisconnected', () => {
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

	async stop(reason: string = 'Бот остановлен вручную.'): Promise<void> {
		try {
			if (!this.bot) {
				Logger.warn('Попытка остановить бота, который не был запущен.')
				return
			}

			await this.bot.memory.save()
			this.isConnected = false
			this.bot.hsm.stop()
			Logger.info('Отключение бота...')
			this.bot.quit(reason)
			this.bot = null
		} catch (error) {
			console.error(error)
		}
	}

	private scheduleReconnect(): void {
		if (this.reconnectAttempts >= this.maxReconnectAttempts) {
			Logger.error(
				'Превышено число попыток реконнекта. Бот больше не подключается.'
			)
			return
		}

		const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts)
		Logger.info(`Попытка реконнекта через ${delay / 1000} секунд...`)

		this.reconnectAttempts += 1
		setTimeout(() => this.start(), delay)
	}
}

export default MinecraftBot
