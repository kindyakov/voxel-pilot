import { isAbsolute } from 'node:path'
import util from 'node:util'

import chalk from 'chalk'
import winston from 'winston'

import type { RuntimeLogLevel } from './runtimeConfig.js'

// Existing callers also pass Error instances and argument arrays.
export type LogMetadata = object
export type CorrelationId = string | null
export type ActionStatus = 'started' | 'completed' | 'failed'

/** Internal logging dependency, never exposed as the dashboard data contract. */
export interface RuntimeLogger {
	readonly correlationId: CorrelationId
	setCorrelationId(id?: CorrelationId): CorrelationId
	clearCorrelationId(): void
	log(level: RuntimeLogLevel, message: string, meta?: LogMetadata): void
	debug(message: string, meta?: LogMetadata): void
	info(message: string, meta?: LogMetadata): void
	warn(message: string, meta?: LogMetadata): void
	error(message: string, meta?: LogMetadata): void
	botAction(action: string, status: ActionStatus, data?: LogMetadata): void
	playerCommand(username: string, command: string, params?: LogMetadata): void
	aiCall(prompt: string, response: string, duration: number): void
	exception(error: Error, context?: string): void
}

/** Raw internal record: telemetry must project allowed fields before publishing it. */
export interface RuntimeLogRecord {
	readonly timestamp: string
	readonly level: RuntimeLogLevel
	readonly message: string
	readonly correlationId: CorrelationId
	readonly meta: Readonly<Record<string, unknown>>
}

export interface RuntimeLoggerOptions {
	readonly aiModel: string
	readonly console:
		| false
		| Readonly<{
				level: RuntimeLogLevel
				colors: boolean
		  }>
	readonly files:
		| false
		| Readonly<{
				logFile: string
				errorLogFile: string
				level: RuntimeLogLevel
				maxBytes: number
				maxFiles: number
		  }>
	readonly sink?: Readonly<{
		level: RuntimeLogLevel
		write(record: RuntimeLogRecord): void
	}>
}

export interface RuntimeLoggerHandle {
	readonly logger: RuntimeLogger
	/** Joins repeated calls and waits for selected transports to finish. */
	close(): Promise<void>
}

const CONSOLE_META_LIMIT = 2000
const levels: Record<RuntimeLogLevel, number> = {
	error: 0,
	warn: 1,
	info: 2,
	debug: 3
}

function validateOptions(options: RuntimeLoggerOptions): void {
	for (const output of [options.console, options.files, options.sink]) {
		if (output && !Object.hasOwn(levels, output.level)) {
			throw new Error('Invalid logger level')
		}
	}
	if (options.files) {
		for (const filename of [
			options.files.logFile,
			options.files.errorLogFile
		]) {
			if (typeof filename !== 'string' || !isAbsolute(filename)) {
				throw new Error('Logger file paths must be absolute')
			}
		}
		for (const limit of [options.files.maxBytes, options.files.maxFiles]) {
			if (!Number.isSafeInteger(limit) || limit <= 0) {
				throw new Error(
					'Logger file retention limits must be positive integers'
				)
			}
		}
	}
}

function consoleFormatter(options: RuntimeLoggerOptions) {
	const color = new chalk.Instance({
		level: options.console && options.console.colors ? 1 : 0
	})
	const colorLevel = (level: string): string => {
		const label = level.toUpperCase()
		switch (level) {
			case 'debug':
				return color.bold.gray(label)
			case 'info':
				return color.bold.blue(label)
			case 'warn':
				return color.bold.yellow(label)
			case 'error':
				return color.bold.red(label)
			default:
				return label
		}
	}
	return winston.format.printf(
		({ level, message, timestamp, correlationId, ...meta }) => {
			const plainMeta = Object.fromEntries(Object.entries(meta))
			let preview = ''
			if (Object.keys(plainMeta).length) {
				const rendered = util.inspect(plainMeta, {
					colors: !!options.console && options.console.colors,
					depth: 5,
					breakLength: Infinity,
					maxArrayLength: 10
				})
				preview = ` ${rendered}`
				if (rendered.length > CONSOLE_META_LIMIT) {
					const detail = options.files
						? `full in ${options.files.logFile}`
						: 'preview truncated'
					preview = ` ${rendered.slice(0, CONSOLE_META_LIMIT)}… (+${rendered.length - CONSOLE_META_LIMIT} chars, ${detail})`
				}
			}
			const corrId = correlationId ? `[${color.bold.cyan(correlationId)}]` : ''
			return `${timestamp} [${colorLevel(level)}]${corrId} ${message}${preview}`.trim()
		}
	)
}

function baseFormat() {
	return winston.format.combine(
		winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
		winston.format.errors({ stack: true })
	)
}

/** Importing this module allocates no logger; every selected resource belongs to the handle. */
export function createRuntimeLogger(
	options: RuntimeLoggerOptions
): RuntimeLoggerHandle {
	validateOptions(options)
	// Snapshot policies so a caller cannot mutate a live transport or formatting policy.
	options = {
		...options,
		console: options.console && { ...options.console },
		files: options.files && { ...options.files },
		sink: options.sink && { ...options.sink }
	}
	const transports: winston.transport[] = []
	if (options.console) {
		transports.push(
			new winston.transports.Console({
				level: options.console.level,
				format: winston.format.combine(baseFormat(), consoleFormatter(options))
			})
		)
	}
	if (options.files) {
		const fileFormat = winston.format.combine(
			baseFormat(),
			winston.format.printf(
				({ level, message, timestamp, correlationId, ...meta }) => {
					const corrId = correlationId ? `[${correlationId}]` : ''
					const metaStr = Object.keys(meta).length ? JSON.stringify(meta) : ''
					return `${timestamp} [${level.toUpperCase()}]${corrId} ${message} ${metaStr}`.trim()
				}
			)
		)
		for (const [filename, level] of [
			[options.files.logFile, options.files.level],
			[options.files.errorLogFile, 'error']
		] as const) {
			transports.push(
				new winston.transports.File({
					filename,
					level,
					format: fileFormat,
					maxsize: options.files.maxBytes,
					maxFiles: options.files.maxFiles
				})
			)
		}
	}
	const backend = winston.createLogger({
		level: 'debug',
		transports,
		silent: transports.length === 0,
		exitOnError: false
	})
	let failure: Error | undefined
	backend.on('error', error => {
		failure = error
	})
	let correlationId: CorrelationId = null
	let closed = false
	let closing: Promise<void> | undefined
	const logger: RuntimeLogger = {
		get correlationId() {
			return correlationId
		},
		setCorrelationId(id = null) {
			correlationId = id || Math.random().toString(36).substring(2, 15)
			return correlationId
		},
		clearCorrelationId() {
			correlationId = null
		},
		log(level, message, meta = {}) {
			if (closed) return
			const snapshot = Object.freeze({ ...meta })
			if (options.sink && levels[level] <= levels[options.sink.level]) {
				try {
					options.sink.write(
						Object.freeze({
							timestamp: new Date().toISOString(),
							level,
							message,
							correlationId,
							meta: snapshot
						})
					)
				} catch {
					// An observer is never allowed to interrupt gameplay or other outputs.
				}
			}
			backend.log(level, message, { ...snapshot, correlationId })
		},
		debug(message, meta) {
			logger.log('debug', message, meta)
		},
		info(message, meta) {
			logger.log('info', message, meta)
		},
		warn(message, meta) {
			logger.log('warn', message, meta)
		},
		error(message, meta) {
			logger.log('error', message, meta)
		},
		botAction(action, status, data) {
			logger.log(
				status === 'failed' ? 'error' : 'info',
				`Действие бота: ${action} - ${status}`,
				{
					action,
					status,
					...data
				}
			)
		},
		playerCommand(username, command, params = {}) {
			logger.info(`Команда от игрока ${username}: ${command}`, {
				username,
				command,
				params
			})
		},
		aiCall(prompt, response, duration) {
			logger.info('Вызов AI', {
				promptLength: prompt.length,
				responseLength: response.length,
				duration,
				model: options.aiModel
			})
		},
		exception(error, context = '') {
			logger.error(
				`Ошибка${context ? ` в ${context}` : ''}: ${error.message}`,
				{
					error: error.stack,
					context
				}
			)
		}
	}
	return Object.freeze({
		logger,
		close() {
			if (closing) return closing
			closed = true
			closing = new Promise<void>((resolve, reject) => {
				const finish = () => settle(failure)
				const settle = (error?: Error) => {
					backend.removeListener('finish', finish)
					backend.removeListener('error', settle)
					backend.close()
					if (error) reject(error)
					else resolve()
				}
				backend.once('finish', finish)
				backend.once('error', settle)
				if (failure) {
					settle(failure)
					return
				}
				backend.end()
			})
			return closing
		}
	})
}
