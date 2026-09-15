import util from 'node:util'

import chalk from 'chalk'
import path from 'path'
import winston from 'winston'

import type { WinstonLogLevel } from '@/types'

import Config from '@/config/config'

// Chalk отключает цвета, когда не видит TTY (сервисный запуск, pipe),
// поэтому уровень включается принудительно: консольный транспорт
// всегда идёт человеку, а файловый формат ниже остаётся без ANSI.
chalk.level = 1

/**
 * Создание корреляционного ID для трекинга операций
 */
function generateCorrelationId(): string {
	return Math.random().toString(36).substring(2, 15)
}

/**
 * Цветовой уровень для подсветки в консоли.
 * Bold добавлен осознанно: серый DEBUG и жёлтый WARN иначе
 * сливаются с обычным текстом на светлой/тёмной теме.
 */
function colorLevel(level: string): string {
	const label = level.toUpperCase()
	switch (level) {
		case 'debug':
			return chalk.bold.gray(label)
		case 'info':
			return chalk.bold.blue(label)
		case 'warn':
			return chalk.bold.yellow(label)
		case 'error':
			return chalk.bold.red(label)
		default:
			return label
	}
}

/**
 * Лимит превью meta в консоли. Консоль — для человека (одна строка
 * на событие), полный дамп всегда остаётся в файловом логе.
 */
const CONSOLE_META_LIMIT = 2000

function formatConsoleMeta(meta: object): string {
	// Winston кладёт в info символьные ключи (Symbol(splat) дублирует
	// весь meta ещё раз). util.inspect, в отличие от JSON.stringify,
	// символы печатает — чистим до plain-объекта со строковыми ключами.
	const plainMeta = Object.fromEntries(Object.entries(meta))
	if (Object.keys(plainMeta).length === 0) return ''
	const rendered = util.inspect(plainMeta, {
		colors: true,
		depth: 5,
		breakLength: Infinity,
		maxArrayLength: 10
	})
	if (rendered.length <= CONSOLE_META_LIMIT) return ` ${rendered}`
	const overflow = rendered.length - CONSOLE_META_LIMIT
	return ` ${rendered.slice(0, CONSOLE_META_LIMIT)}… (+${overflow} chars, full in ${Config.logging.file})`
}

/**
 * Базовый форматтер для логов с корреляционным ID (без подсветки)
 */
const baseFormat = winston.format.combine(
	winston.format.timestamp({
		format: 'YYYY-MM-DD HH:mm:ss'
	}),
	winston.format.errors({ stack: true })
)

/**
 * Форматтер для консоли с подсветкой по уровням
 */
const consoleFormat = winston.format.combine(
	baseFormat,
	winston.format.printf(
		({ level, message, timestamp, correlationId, ...meta }) => {
			const corrId = correlationId ? `[${chalk.bold.cyan(correlationId)}]` : ''
			return `${timestamp} [${colorLevel(level)}]${corrId} ${message}${formatConsoleMeta(meta)}`.trim()
		}
	)
)

/**
 * Форматтер для файлов (без ANSI-кодов)
 */
const fileFormat = winston.format.combine(
	baseFormat,
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
	new winston.transports.Console({
		level: Config.isDevelopment ? 'debug' : Config.logging.level,
		format: consoleFormat
	})
]

if (Config.isProduction || Config.logging.file) {
	const logDir = path.dirname(path.resolve(Config.logging.file))

	transports.push(
		new winston.transports.File({
			filename: Config.logging.file,
			level: Config.logging.level,
			format: fileFormat,
			maxsize: 10 * 1024 * 1024,
			maxFiles: 5
		}),
		new winston.transports.File({
			filename: path.join(logDir, 'error.log'),
			level: 'error',
			format: fileFormat,
			maxsize: 10 * 1024 * 1024,
			maxFiles: 5
		})
	)
}

/**
 * Основной логгер Winston
 */
const logger: winston.Logger = winston.createLogger({
	level: Config.logging.level,
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

	clearCorrelationId(): void {
		this.correlationId = null
	}

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

	aiCall(prompt: string, response: string, duration: number): void {
		this.info('Вызов AI', {
			promptLength: prompt.length,
			responseLength: response.length,
			duration,
			model: Config.ai.model
		})
	}

	exception(error: Error, context: string = ''): void {
		this.error(`Ошибка${context ? ` в ${context}` : ''}: ${error.message}`, {
			error: error.stack,
			context
		})
	}
}

export default new BotLogger()
