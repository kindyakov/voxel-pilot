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
		this._minecraft = {
			host: process.env.MINECRAFT_HOST || 'localhost',
			port: parseInt(process.env.MINECRAFT_PORT || '25565', 10),
			username: process.env.MINECRAFT_USERNAME || 'bot',
			version: process.env.MINECRAFT_VERSION || '1.20.1'
		}

		this._ai = {
			provider: process.env.AI_PROVIDER || 'openai',
			baseUrl: process.env.AI_BASE_URL || undefined,
			model: process.env.AI_MODEL || 'gpt-5-mini',
			apiKey: process.env.AI_API_KEY,
			timeout: parseInt(process.env.AI_TIMEOUT_MS || '15000', 10),
			maxTokens: parseInt(process.env.AI_MAX_TOKENS || '800', 10)
		}

		this._logging = {
			level: (process.env.LOG_LEVEL as WinstonLogLevel) || 'info',
			file: process.env.LOG_FILE || 'logs/bot.log'
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
		if (this._ai.provider === 'disabled' || this._ai.provider === 'local') {
			return
		}

		if (!this._ai.apiKey) {
			throw new Error('Missing required environment variable: AI_API_KEY')
		}
	}
}

export default new Config()
