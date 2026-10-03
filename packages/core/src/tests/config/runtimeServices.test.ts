import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import {
	mkdir,
	mkdtemp,
	readFile,
	readdir,
	rm,
	writeFile
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
	createRuntimeConfig,
	createRuntimeConfigFromEnvironment,
	createRuntimeLogger,
	createRuntimeServices
} from '../../config/services.js'
import type {
	RuntimeConfigValues,
	RuntimeLogRecord,
	RuntimePaths
} from '../../config/services.js'

function fixtureValues(directory: string): RuntimeConfigValues {
	return {
		minecraft: {
			host: 'localhost',
			port: 25565,
			username: 'fixture-bot',
			version: '1.20.4'
		},
		ai: {
			provider: 'disabled',
			baseUrl: undefined,
			model: 'fixture-model',
			apiKey: undefined,
			timeout: 15000,
			maxTokens: 1000
		},
		diagnostics: {
			viewerPort: 3000,
			webInventoryPort: 3001,
			hsmEnabled: false
		},
		logging: { level: 'info' },
		paths: {
			settingsFile: join(directory, 'settings.env'),
			memoryDir: join(directory, 'memory'),
			profileDir: join(directory, 'profile'),
			logFile: join(directory, 'logs', 'bot.log'),
			errorLogFile: join(directory, 'logs', 'error.log'),
			aiRequestDumpDir: join(directory, 'logs', 'ai-requests')
		},
		environment: 'test',
		aiDebugDump: false
	}
}

test('explicit config snapshots values and service creation opens no stores or output', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'voxel-services-'))
	const handle = createRuntimeLogger({
		aiModel: 'fixture-model',
		console: false,
		files: false
	})
	try {
		const values = fixtureValues(directory)
		const config = createRuntimeConfig(values)
		const services = createRuntimeServices({ config, logger: handle.logger })
		assert.equal(services.config, config)
		assert.equal(services.logger, handle.logger)
		assert.ok(Object.isFrozen(services))
		assert.ok(Object.isFrozen(config.paths))
		assert.ok(Object.isFrozen(config.ai))
		assert.notEqual(config.minecraft, values.minecraft)
		Object.assign(values.minecraft, { host: 'changed.invalid' })
		Object.assign(values.paths, { memoryDir: join(directory, 'changed') })
		assert.equal(config.minecraft.host, 'localhost')
		assert.equal(config.paths.memoryDir, join(directory, 'memory'))
		assert.equal(config.aiDebugDump, false)
		assert.equal(config.diagnostics.hsmEnabled, false)
		handle.logger.info('silent output')
		assert.deepEqual(await readdir(directory), [])
	} finally {
		await handle.close()
		await rm(directory, { recursive: true, force: true })
	}
})

test('explicit config validates paths, numbers and remote credentials without reading env', () => {
	const values = fixtureValues(tmpdir())
	assert.throws(
		() =>
			createRuntimeConfig({
				...values,
				minecraft: { ...values.minecraft, port: 0 }
			}),
		/minecraft.port/
	)
	assert.throws(
		() =>
			createRuntimeConfig({
				...values,
				minecraft: { ...values.minecraft, port: 65536 }
			}),
		/minecraft.port/
	)
	assert.throws(
		() =>
			createRuntimeConfig({ ...values, ai: { ...values.ai, timeout: 1.5 } }),
		/ai.timeout/
	)
	assert.throws(
		() =>
			createRuntimeConfig({
				...values,
				paths: { ...values.paths, memoryDir: 'relative/data' }
			}),
		/must be absolute/
	)
	assert.throws(
		() =>
			createRuntimeConfig({
				...values,
				ai: { ...values.ai, provider: 'openai' }
			}),
		/AI_API_KEY/
	)
	assert.doesNotThrow(() =>
		createRuntimeConfig({ ...values, ai: { ...values.ai, provider: 'local' } })
	)
	const config = createRuntimeConfig({
		...values,
		environment: 'development',
		paths: { ...values.paths, settingsFile: null },
		ai: {
			...values.ai,
			provider: 'openai',
			apiKey: 'safe-fixture-key',
			baseUrl: 'http://127.0.0.1:9/v1'
		}
	})
	assert.equal(config.isDevelopment, true)
	assert.equal(config.isProduction, false)
	assert.equal(config.paths.settingsFile, null)
})

test('environment conversion uses only the passed snapshot and leaves it unchanged', () => {
	const paths: RuntimePaths = fixtureValues(tmpdir()).paths
	const values = Object.freeze({
		MINECRAFT_HOST: 'explicit.invalid',
		MINECRAFT_PORT: '25566',
		MINECRAFT_USERNAME: 'explicit-bot',
		MINECRAFT_VERSION: '1.20.4',
		AI_PROVIDER: 'disabled',
		AI_MODEL: 'explicit-model',
		AI_BASE_URL: '',
		AI_DEBUG_DUMP: '1',
		HSM_DIAGNOSTICS: '1',
		LOG_LEVEL: 'debug',
		NODE_ENV: 'development'
	})
	const config = createRuntimeConfigFromEnvironment(values, paths)
	assert.equal(config.minecraft.host, 'explicit.invalid')
	assert.equal(config.minecraft.port, 25566)
	assert.equal(config.ai.model, 'explicit-model')
	assert.equal(config.ai.baseUrl, undefined)
	assert.equal(config.ai.timeout, 15000)
	assert.equal(config.logging.level, 'debug')
	assert.equal(config.aiDebugDump, true)
	assert.equal(config.diagnostics.hsmEnabled, true)
	assert.equal('AI_TIMEOUT_MS' in values, false)
	assert.throws(
		() =>
			createRuntimeConfigFromEnvironment(
				{ ...values, MINECRAFT_PORT: 'invalid' },
				paths
			),
		/Invalid environment variables/
	)
	assert.throws(
		() =>
			createRuntimeConfigFromEnvironment(
				{ ...values, LOG_LEVEL: 'invalid' },
				paths
			),
		/logging.level/
	)
	assert.throws(
		() =>
			createRuntimeConfigFromEnvironment(
				{ ...values, AI_DEBUG_DUMP: 'yes' },
				paths
			),
		/AI_DEBUG_DUMP/
	)
	const defaults = createRuntimeConfigFromEnvironment(
		{ ...values, AI_DEBUG_DUMP: undefined, HSM_DIAGNOSTICS: undefined },
		paths
	)
	assert.equal(defaults.aiDebugDump, false)
	assert.equal(defaults.diagnostics.hsmEnabled, false)
})

test('separate loggers own their correlation, model and sink level, and repeated close joins', async () => {
	const firstRecords: RuntimeLogRecord[] = []
	const secondRecords: RuntimeLogRecord[] = []
	const first = createRuntimeLogger({
		aiModel: 'first-model',
		console: false,
		files: false,
		sink: { level: 'debug', write: record => firstRecords.push(record) }
	})
	const second = createRuntimeLogger({
		aiModel: 'second-model',
		console: false,
		files: false,
		sink: { level: 'info', write: record => secondRecords.push(record) }
	})
	try {
		first.logger.setCorrelationId('FIRST')
		first.logger.debug('first debug')
		second.logger.debug('second hidden debug')
		second.logger.info('second info')
		first.logger.aiCall('private first prompt', 'private first response', 20)
		second.logger.aiCall('private second prompt', 'private second response', 30)
		assert.equal(second.logger.correlationId, null)
		assert.equal(firstRecords[0]?.correlationId, 'FIRST')
		assert.equal(secondRecords.length, 2)
		assert.equal(firstRecords[1]?.meta.model, 'first-model')
		assert.equal(secondRecords[1]?.meta.model, 'second-model')
		assert.ok(!JSON.stringify(firstRecords).includes('private first prompt'))
		first.logger.clearCorrelationId()
		first.logger.info('first cleared')
		assert.equal(firstRecords[2]?.correlationId, null)
		const closing = first.close()
		assert.equal(first.close(), closing)
		await closing
		first.logger.info('after close')
		assert.equal(firstRecords.length, 3)
		second.logger.info('second still active')
		assert.equal(secondRecords.length, 3)
	} finally {
		await Promise.all([first.close(), second.close()])
	}
})

test('live raw subscriptions own no replay and independently isolate levels, failures, disposal and close', async () => {
	const sink: string[] = [],
		records: RuntimeLogRecord[] = []
	const handle = createRuntimeLogger({
		aiModel: 'source-fixture',
		console: false,
		files: false,
		sink: {
			level: 'warn',
			write(record) {
				sink.push(`${this.level}:${record.message}`)
			}
		}
	})
	const logger = handle.logger
	logger.info('before observation')
	logger.subscribeRecords(() => {
		throw new Error('observer failed')
	})
	logger.subscribeRecords(async () => {
		throw new Error('async observer failed')
	})
	const listen = (record: RuntimeLogRecord) => {
		records.push(record)
	}
	const first = logger.subscribeRecords(listen)
	const second = logger.subscribeRecords(listen)
	assert.equal(records.length, 0)
	logger.debug('debug')
	assert.equal(records.length, 2)
	assert.equal(records[0], records[1])
	assert.ok(Object.isFrozen(records[0]) && Object.isFrozen(records[0]!.meta))
	first()
	first()
	logger.info('info')
	assert.equal(records.length, 3)
	let skipped = 0
	let disposeOther: () => void
	logger.subscribeRecords(() => {
		disposeOther()
	}, 'warn')
	disposeOther = logger.subscribeRecords(() => {
		skipped++
	}, 'warn')
	logger.warn('warn')
	assert.equal(skipped, 0)
	assert.deepEqual(sink, ['warn:warn'])
	second()
	await handle.close()
	logger.error('closed')
	const late = logger.subscribeRecords(() => {
		throw new Error('closed observer must not run')
	})
	late()
	late()
	assert.equal(records.length, 4)
	assert.deepEqual(sink, ['warn:warn'])
	assert.throws(() => {
		// @ts-expect-error Exercise the invalid level boundary for JavaScript callers.
		logger.subscribeRecords(listen, 'invalid')
	}, /Invalid logger level/)
})

test('file level and retention are explicit and close persists output even when sink throws', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'voxel-logger-'))
	const handle = createRuntimeLogger({
		aiModel: 'fixture-model',
		console: false,
		files: {
			logFile: join(directory, 'bot.log'),
			errorLogFile: join(directory, 'error.log'),
			level: 'info',
			maxBytes: 10000,
			maxFiles: 2
		},
		sink: {
			level: 'debug',
			write: () => {
				throw new Error('observer failed')
			}
		}
	})
	try {
		handle.logger.debug('file-hidden-debug')
		handle.logger.info('file-visible-info', { value: 42 })
		handle.logger.error('file-visible-error')
		await handle.close()
		const contents = await readFile(join(directory, 'bot.log'), 'utf8')
		assert.match(contents, /file-visible-info/)
		assert.match(contents, /file-visible-error/)
		assert.ok(!contents.includes('file-hidden-debug'))
		const errors = await readFile(join(directory, 'error.log'), 'utf8')
		assert.match(errors, /file-visible-error/)
		assert.ok(!errors.includes('file-visible-info'))
	} finally {
		await handle.close()
		await rm(directory, { recursive: true, force: true })
	}
	assert.throws(
		() =>
			createRuntimeLogger({
				aiModel: 'fixture',
				console: false,
				files: {
					logFile: 'relative.log',
					errorLogFile: 'error.log',
					level: 'info',
					maxBytes: 10,
					maxFiles: 2
				}
			}),
		/absolute/
	)
	assert.throws(
		() =>
			createRuntimeLogger({
				aiModel: 'fixture',
				console: false,
				files: {
					logFile: join(directory, 'bot.log'),
					errorLogFile: join(directory, 'error.log'),
					level: 'info',
					maxBytes: 0,
					maxFiles: 2
				}
			}),
		/retention/
	)
})

test('logger close reports file transport failure instead of hanging or claiming persistence', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'voxel-logger-error-'))
	const logFile = join(directory, 'blocked.log')
	const errorLogFile = join(directory, 'blocked-error.log')
	await Promise.all([mkdir(logFile), mkdir(errorLogFile)])
	const handle = createRuntimeLogger({
		aiModel: 'fixture',
		console: false,
		files: {
			logFile,
			errorLogFile,
			level: 'info',
			maxBytes: 10000,
			maxFiles: 2
		}
	})
	try {
		handle.logger.info('cannot persist to a directory')
		const close = handle.close()
		assert.equal(handle.close(), close)
		await assert.rejects(close)
	} finally {
		await rm(directory, { recursive: true, force: true })
	}
})

test(
	'logger close reports the native stream error with one blocked output',
	{ timeout: 2000 },
	async () => {
		const directory = await mkdtemp(join(tmpdir(), 'voxel-logger-open-error-'))
		const logFile = join(directory, 'blocked.log')
		await mkdir(logFile)
		const handle = createRuntimeLogger({
			aiModel: 'fixture',
			console: false,
			files: {
				logFile,
				errorLogFile: join(directory, 'error.log'),
				level: 'info',
				maxBytes: 10000,
				maxFiles: 2
			}
		})
		try {
			handle.logger.info('cannot persist to a directory')
			const close = handle.close()
			assert.equal(handle.close(), close)
			await assert.rejects(close, {
				code: 'EISDIR'
			})
		} finally {
			await rm(directory, { recursive: true, force: true })
		}
	}
)

test('new service imports and silent construction work without required environment or file artifacts', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'voxel-import-'))
	try {
		await writeFile(
			join(directory, '.env'),
			'MINECRAFT_HOST=must-not-load.invalid\nIMPORT_ENV_MARKER=must-not-load\n'
		)
		const moduleUrl = new URL('../../config/services.ts', import.meta.url).href
		const source = `
			const { createRuntimeConfig, createRuntimeLogger, createRuntimeServices } = await import(${JSON.stringify(moduleUrl)});
			const paths = ${JSON.stringify(fixtureValues(directory))};
			const config = createRuntimeConfig(paths);
			const handle = createRuntimeLogger({aiModel: config.ai.model, console: false, files: false});
			createRuntimeServices({config, logger: handle.logger});
			handle.logger.info('silent');
			await handle.close();
			if (process.env.IMPORT_ENV_MARKER || process.env.MINECRAFT_HOST) throw new Error('env was loaded');
			process.stdout.write('safe import');
		`
		const env = Object.fromEntries(
			['PATH', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP'].flatMap(key =>
				process.env[key] ? [[key, process.env[key]!]] : []
			)
		)
		const output = execFileSync(
			process.execPath,
			[
				'--import',
				import.meta.resolve('tsx'),
				'--input-type=module',
				'--eval',
				source
			],
			{
				cwd: directory,
				env,
				encoding: 'utf8',
				timeout: 10000
			}
		)
		assert.equal(output, 'safe import')
		assert.deepEqual(await readdir(directory), ['.env'])
	} finally {
		await rm(directory, { recursive: true, force: true })
	}
})
