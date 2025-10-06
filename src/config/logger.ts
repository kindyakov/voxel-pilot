import winston from 'winston'
import config from './config'
import path from 'path'
import { WinstonLogLevel } from '../types'

/**
 * Создание корреляционного ID для трекинга операций
 */
function generateCorrelationId(): string {
	return Math.random().toString(36).substring(2, 15)
}

/**
 * Форматтер для логов с корреляционным ID
 */
const logFormat = winston.format.combine(
	winston.format.timestamp({
		format: 'YYYY-MM-DD HH:mm:ss'
	}),
	winston.format.errors({ stack: true }),
	winston.format.printf(
		({ level, message, timestamp, correlationId, ...meta }) => {
			const corrId = correlationId ? `[${correlationId}]` : ''
			const metaStr = Object.keys(meta).length ? JSON.stringify(meta) : ''
			return `${timestamp} [${level.toUpperCase()}]${corrId} ${message} ${metaStr}`.trim()
		}
	)
)

/**
 * Настройка транспортов Winston
 */
const transports: winston.transport[] = [
	// Консольный вывод для разработки
	new winston.transports.Console({
		level: config.isDevelopment ? 'debug' : config.logging.level,
		format: winston.format.combine(winston.format.colorize(), logFormat)
	})
]

// Файловый транспорт для продакшена
if (config.isProduction || config.logging.file) {
	const logDir = path.dirname(path.resolve(config.logging.file))

	transports.push(
		// Общие логи
		new winston.transports.File({
			filename: config.logging.file,
			level: config.logging.level,
			format: logFormat,
			maxsize: 10 * 1024 * 1024, // 10MB
			maxFiles: 5
		}),
		// Отдельный файл для ошибок
		new winston.transports.File({
			filename: path.join(logDir, 'error.log'),
			level: 'error',
			format: logFormat,
			maxsize: 10 * 1024 * 1024,
			maxFiles: 5
		})
	)
}

/**
 * Основной логгер Winston
 */
const logger: winston.Logger = winston.createLogger({
	level: config.logging.level,
	format: logFormat,
	transports,
	exitOnError: false
})

type CorrelationId = string | null
type ActionStatus = 'started' | 'completed' | 'failed'

/**
 * Обертка логгера с поддержкой корреляционного ID
 */
class BotLogger {
	public correlationId: CorrelationId

	constructor() {
		this.correlationId = null
	}

	setCorrelationId(id: CorrelationId = null): CorrelationId {
		this.correlationId = id || generateCorrelationId()
		return this.correlationId
	}

	/**
	 * Сброс корреляционного ID
	 */
	clearCorrelationId(): void {
		this.correlationId = null
	}

	/**
	 * Создание лог-записи с корреляционным ID
	 */
	log(
		level: WinstonLogLevel,
		message: string,
		meta: Record<string, any> = {}
	): void {
		const logData = {
			...meta,
			correlationId: this.correlationId
		}
		logger.log(level, message, logData)
	}

	debug(message: string, meta: Record<string, any> = {}): void {
		this.log('debug', message, meta)
	}

	info(message: string, meta: Record<string, any> = {}): void {
		this.log('info', message, meta)
	}

	warn(message: string, meta: Record<string, any> = {}): void {
		this.log('warn', message, meta)
	}

	error(message: string, meta: Record<string, any> = {}): void {
		this.log('error', message, meta)
	}

	/**
	 * Логирование действий бота
	 */
	botAction(
		action: string,
		status: ActionStatus,
		data: Record<string, any> = {}
	): void {
		const message = `Действие бота: ${action} - ${status}`
		const level = status === 'failed' ? 'error' : 'info'

		this.log(level, message, {
			action,
			status,
			...data
		})
	}

	/**
	 * Логирование команд от игрока
	 */
	playerCommand(
		username: string,
		command: string,
		params: Record<string, any> = {}
	): void {
		this.info(`Команда от игрока ${username}: ${command}`, {
			username,
			command,
			params
		})
	}

	/**
	 * Логирование вызовов AI
	 */
	aiCall(prompt: string, response: string, duration: number): void {
		this.info('Вызов AI', {
			promptLength: prompt.length,
			responseLength: response.length,
			duration,
			model: config.ai.model
		})
	}

	/**
	 * Логирование ошибок с трассировкой стека
	 * @param {Error} error - объект ошибки
	 * @param {string} [context] - контекст возникновения ошибки
	 */
	exception(error: Error, context: string = ''): void {
		this.error(`Ошибка${context ? ` в ${context}` : ''}: ${error.message}`, {
			error: error.stack,
			context
		})
	}
}

export default new BotLogger()
