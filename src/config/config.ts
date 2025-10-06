import 'dotenv/config'
import { WinstonLogLevel } from '../types'

interface MinecraftConfig {
	host: string
	port: number
	username: string
	version: string
}

interface AIConfig {
	provider: string
	model: string
	apiKey: string | undefined
	timeout: number
	maxTokens: number
}

interface LoggingConfig {
	level: WinstonLogLevel
	file: string
}

class Config {
	private readonly _minecraft: MinecraftConfig
	private readonly _ai: AIConfig
	private readonly _logging: LoggingConfig

	constructor() {
		this._minecraft = {
			host: process.env.MINECRAFT_HOST || 'localhost',
			port: parseInt(process.env.MINECRAFT_PORT || '25565', 10),
			username: process.env.MINECRAFT_USERNAME || 'bot',
			version: process.env.MINECRAFT_VERSION || '1.20.1'
		}

		this._ai = {
			provider: process.env.AI_PROVIDER || 'openai',
			model: process.env.AI_MODEL || 'gpt-4o-mini',
			apiKey: process.env.AI_API_KEY,
			timeout: parseInt(process.env.AI_TIMEOUT_MS || '800', 10),
			maxTokens: parseInt(process.env.AI_MAX_TOKENS || '300', 10)
		}

		this._logging = {
			level: (process.env.LOG_LEVEL as WinstonLogLevel) || 'info',
			file: process.env.LOG_FILE || 'logs/bot.log'
		}
	}
	// Minecraft настройки
	get minecraft(): MinecraftConfig {
		return this._minecraft
	}

	// AI настройки
	get ai(): AIConfig {
		return this._ai
	}

	// Логирование
	get logging(): LoggingConfig {
		return this._logging
	}

	/**
	 * Получение конфигурации для определенного окружения
	 */
	get isDevelopment(): boolean {
		return process.env.NODE_ENV === 'development'
	}

	get isProduction(): boolean {
		return process.env.NODE_ENV === 'production'
	}

	private getRequiredEnv(key: string): string {
		const value = process.env[key]
		if (!value) {
			throw new Error(`Missing required environment variable: ${key}`)
		}
		return value
	}
}

export default new Config()
