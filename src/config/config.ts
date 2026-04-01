import 'dotenv/config'

import { WinstonLogLevel } from '../types/index.js'
import { validateEnv } from './env.js'

interface MinecraftConfig {
	host: string
	port: number
	username: string
	version: string
}

interface AIConfig {
	provider: string
	baseUrl: string | undefined
	model: string
	apiKey: string | undefined
	timeout: number
	maxTokens: number
}

interface LoggingConfig {
	level: WinstonLogLevel
	file: string
}

export class Config {
	private readonly _minecraft: MinecraftConfig
	private readonly _ai: AIConfig
	private readonly _logging: LoggingConfig

	constructor() {
		const env = validateEnv()

		this._minecraft = {
			host: env.MINECRAFT_HOST!,
			port: parseInt(env.MINECRAFT_PORT!, 10),
			username: env.MINECRAFT_USERNAME!,
			version: env.MINECRAFT_VERSION!
		}

		this._ai = {
			provider: env.AI_PROVIDER!,
			baseUrl: env.AI_BASE_URL,
			model: env.AI_MODEL!,
			apiKey: env.AI_API_KEY,
			timeout: parseInt(env.AI_TIMEOUT_MS || '15000', 10),
			maxTokens: parseInt(env.AI_MAX_TOKENS || '1000', 10)
		}

		this._logging = {
			level: (env.LOG_LEVEL as WinstonLogLevel) || 'info',
			file: env.LOG_FILE || 'logs/bot.log'
		}
	}

	get minecraft(): MinecraftConfig {
		return this._minecraft
	}
	get ai(): AIConfig {
		return this._ai
	}
	get logging(): LoggingConfig {
		return this._logging
	}

	get isDevelopment(): boolean {
		return process.env.NODE_ENV === 'development'
	}

	get isProduction(): boolean {
		return process.env.NODE_ENV === 'production'
	}

	assertAIConfigured(): void {
		if (this._ai.provider === 'disabled' || this._ai.provider === 'local')
			return
		if (!this._ai.apiKey) throw new Error('Missing AI_API_KEY in .env')
	}
}

export default new Config()
