import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { setImmediate as flush } from 'node:timers/promises'

import type { LogEntry, LogUpdate } from '@voxel-pilot/contracts'

import type { RuntimeLoggerOptions } from '../../config/runtimeLogger.js'
import {
	createRuntimeConfigFromEnvironment,
	createRuntimeLogger,
	createRuntimeServices
} from '../../config/services.js'
import { MemoryManager } from '../../core/memory/index.js'
import { ProfileMemoryStore } from '../../core/profile/index.js'
import { createBotRuntime } from '../../core/runtime.js'
import type { LogHistoryOptions } from '../../core/telemetry/logJournal.js'
import { createRuntimeConnectionBot } from './fixtures/runtimeBot.js'

const dummyKey = 'dummy-private-api-key-28'
const endpoint =
	'https://dummy%2Fuser:dummy%2Fpassword@provider.invalid/v1?token=dummy%2Fquery#dummy-fragment'

function fixture(
	t: test.TestContext,
	logs?: LogHistoryOptions,
	output: Pick<RuntimeLoggerOptions, 'console' | 'files' | 'sink'> = {
		console: false,
		files: false
	},
	key = dummyKey
) {
	const handle = createRuntimeLogger({ aiModel: 'fixture', ...output })
	const source = t.mock.method(handle.logger, 'subscribeRecords')
	const config = createRuntimeConfigFromEnvironment(
		{
			MINECRAFT_HOST: 'localhost',
			MINECRAFT_PORT: '25565',
			MINECRAFT_USERNAME: 'journal-fixture',
			MINECRAFT_VERSION: '1.20.4',
			AI_PROVIDER: 'disabled',
			AI_MODEL: 'fixture',
			AI_API_KEY: key,
			AI_BASE_URL: endpoint
		},
		{
			settingsFile: null,
			memoryDir: tmpdir(),
			profileDir: tmpdir(),
			logFile: join(tmpdir(), 'unused-journal.log'),
			errorLogFile: join(tmpdir(), 'unused-journal-error.log'),
			aiRequestDumpDir: tmpdir()
		}
	)
	const services = createRuntimeServices({ config, logger: handle.logger })
	t.mock.method(MemoryManager.prototype, 'load', async () => {})
	const save = t.mock.method(MemoryManager.prototype, 'save', async () => {})
	t.mock.method(MemoryManager.prototype, 'close', () => {})
	t.mock.method(ProfileMemoryStore.prototype, 'load', async () => {})
	t.mock.method(ProfileMemoryStore.prototype, 'close', () => {})
	const bots: ReturnType<typeof createRuntimeConnectionBot>[] = []
	const runtime = createBotRuntime(services, {
		logs,
		stopTimeoutMs: 100,
		connection: {
			createBot() {
				const bot = createRuntimeConnectionBot()
				bots.push(bot)
				return bot.asBot()
			},
			initConnection: () => () => {}
		}
	})
	t.after(async () => {
		await runtime.stop()
		await handle.close()
	})
	return {
		runtime,
		logger: handle.logger,
		handle,
		services,
		source,
		bots,
		save
	}
}

function bytes(entry: LogEntry): number {
	return Buffer.byteLength(JSON.stringify(entry), 'utf8')
}

test('late log subscription receives cached safe history, then structured appends independent of bot snapshots', async t => {
	const { runtime, logger, bots } = fixture(t)
	const initial = runtime.telemetry.getLogHistory()
	assert.equal(initial, runtime.telemetry.getLogHistory())
	assert.equal(initial.level, 'debug')
	assert.deepEqual(initial.limits, {
		maxEntries: 2000,
		maxBytes: 2 * 1024 * 1024,
		maxEntryBytes: 16 * 1024
	})
	assert.equal(bots.length, 0)
	const gameplay = runtime.telemetry.getSnapshot()
	logger.info('[HSM] ready', { status: 'ready' })
	const updates: LogUpdate[] = []
	const dispose = runtime.telemetry.subscribeLogs(update => {
		updates.push(update)
	})
	assert.equal(updates.length, 1)
	assert.equal(updates[0]?.kind, 'snapshot')
	assert.equal(updates[0]?.history, runtime.telemetry.getLogHistory())
	assert.equal(updates[0]?.history.entries[0]?.source, 'HSM')
	logger.debug('next', { source: 'AI', attempt: 2 })
	const appended = updates[1]
	assert.equal(appended?.kind, 'append')
	assert.ok(appended && appended.kind === 'append')
	assert.equal(appended.entry, appended.history.entries[1])
	assert.equal(appended.entry.source, 'AI')
	assert.match(appended.entry.message, /attempt=2/)
	assert.ok(Number.isFinite(appended.entry.timestamp))
	assert.equal(runtime.telemetry.getSnapshot(), gameplay)
	assert.deepEqual(
		JSON.parse(JSON.stringify(appended.history)),
		appended.history
	)
	assert.ok(
		Object.isFrozen(appended.history) &&
			Object.isFrozen(appended.history.entries)
	)
	assert.ok(
		Object.isFrozen(appended.entry) &&
			Object.isFrozen(appended.history.stats.acceptedByLevel)
	)
	assert.throws(() => Object.assign(appended.entry, { message: 'mutated' }))
	dispose()
	dispose()
	logger.warn('after unsubscribe')
	assert.equal(updates.length, 2)
})

test('count eviction preserves identities and cumulative per-level accepted/evicted totals', async t => {
	const { runtime, logger } = fixture(t, { maxEntries: 3 })
	const accepted: LogEntry[] = []
	runtime.telemetry.subscribeLogs(update => {
		if (update.kind === 'append') accepted.push(update.entry)
	})
	logger.debug('one')
	logger.info('two')
	logger.warn('three')
	logger.error('four')
	logger.debug('five')
	const history = runtime.telemetry.getLogHistory()
	assert.deepEqual(history.entries, accepted.slice(2))
	assert.equal(new Set(accepted.map(entry => entry.id)).size, 5)
	assert.equal(history.revision, 5)
	assert.deepEqual(history.stats.acceptedByLevel, {
		debug: 2,
		info: 1,
		warn: 1,
		error: 1
	})
	assert.equal(history.stats.acceptedEntries, 5)
	assert.equal(history.stats.evictedEntries, 2)
	assert.equal(
		history.stats.evictedBytes,
		bytes(accepted[0]!) + bytes(accepted[1]!)
	)
	assert.equal(
		history.stats.retainedBytes,
		history.entries.reduce((sum, entry) => sum + bytes(entry), 0)
	)
	assert.equal(runtime.telemetry.getLogHistory(), history)
	let late: LogUpdate | undefined
	runtime.telemetry.subscribeLogs(value => {
		late = value
	})
	assert.equal(late?.history, history)
})

test('UTF-8 byte cap independently evicts Unicode/escaped text even when count cap fits', async t => {
	const { runtime, logger } = fixture(t, {
		maxEntries: 50,
		maxBytes: 600,
		maxEntryBytes: 512
	})
	const accepted: LogEntry[] = []
	runtime.telemetry.subscribeLogs(update => {
		if (update.kind === 'append') accepted.push(update.entry)
	})
	for (let index = 0; index < 3; index++)
		logger.info(`${index} ${'Привет 😀\n'.repeat(8)}`)
	const history = runtime.telemetry.getLogHistory()
	assert.equal(history.stats.truncatedEntries, 0)
	assert.ok(history.stats.evictedEntries > 0)
	assert.ok(
		history.entries.length < 3 &&
			history.entries.length < history.limits.maxEntries
	)
	assert.ok(history.stats.retainedBytes <= 600)
	assert.equal(
		history.stats.retainedBytes,
		history.entries.reduce((sum, entry) => sum + bytes(entry), 0)
	)
	assert.equal(
		history.stats.evictedBytes + history.stats.retainedBytes,
		accepted.reduce((sum, entry) => sum + bytes(entry), 0)
	)
})

test('oversized entries redact before UTF-8 shortening and expose source truncation without broken Unicode', async t => {
	const { runtime, logger } = fixture(t, { maxBytes: 512, maxEntryBytes: 256 })
	const message = `${'prefix '.repeat(9)}${dummyKey}${'😀 кириллица\n'.repeat(100)}`
	logger.info(message)
	const history = runtime.telemetry.getLogHistory()
	const entry = history.entries[0]!
	assert.ok(bytes(entry) <= 256)
	assert.match(entry.message, /… \[truncated\]$/)
	assert.equal(Buffer.from(entry.message).toString('utf8'), entry.message)
	assert.equal(
		entry.truncation?.originalMessageBytes,
		Buffer.byteLength(message.replace(dummyKey, '<REDACTED>'))
	)
	assert.equal(history.stats.truncatedEntries, 1)
	assert.ok(!JSON.stringify(history).includes(dummyKey))
	assert.ok(!entry.message.includes('dummy-private-api'))
	logger.warn('following')
	assert.ok(runtime.telemetry.getLogHistory().stats.retainedBytes <= 512)
})

test('history byte cap also bounds one oversized entry when the configured entry cap is larger', async t => {
	const { runtime, logger } = fixture(t, { maxBytes: 256, maxEntryBytes: 4096 })
	logger.info('first '.repeat(1000))
	const first = runtime.telemetry.getLogHistory().entries[0]!
	assert.ok(bytes(first) <= 256)
	assert.ok(first.truncation)
	logger.error('second '.repeat(1000))
	const history = runtime.telemetry.getLogHistory()
	assert.equal(history.entries.length, 1)
	assert.notEqual(history.entries[0]?.id, first.id)
	assert.equal(history.stats.evictedEntries, 1)
	assert.equal(history.stats.truncatedEntries, 2)
	assert.equal(history.stats.evictedBytes, bytes(first))
	assert.ok(history.stats.retainedBytes <= 256)
})

test('small record caps cannot expose a credential prefix or an executable terminal-control fragment', async t => {
	const { runtime, logger } = fixture(t, { maxBytes: 512, maxEntryBytes: 256 })
	logger.error(
		`\u001b]8;;${endpoint}\u0007${'padding '.repeat(6)}${dummyKey}${'😀'.repeat(100)}\u001b]8;;\u0007`
	)
	const entry = runtime.telemetry.getLogHistory().entries[0]!
	assert.ok(bytes(entry) <= 256)
	assert.ok(entry.truncation)
	assert.match(entry.message, /… \[truncated\]$/)
	assert.ok(!/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/.test(entry.message))
	assert.ok(
		!entry.message.includes(dummyKey) &&
			!entry.message.includes('dummy-private-api')
	)
	assert.match(entry.message, /\\u001b/)
})

test('public logs exclude raw prompts/stacks/objects and redact known key and encoded endpoint secrets', async t => {
	const { runtime, logger } = fixture(t)
	const cycle: { self?: object; private: string } = {
		private: 'CYCLIC_PRIVATE_28'
	}
	cycle.self = cycle
	logger.error(
		`failed ${dummyKey} ${endpoint}/chat/completions dummy/user dummy%2fpassword dummy/query dummy%2Fquery dummy-fragment`,
		{
			source: 'AI',
			reason: `approved ${dummyKey}`,
			attempt: 3,
			prompt: 'PROMPT_PRIVATE_28',
			transcript: 'TRANSCRIPT_PRIVATE_28',
			headers: { auth: 'HEADER_PRIVATE_28' },
			bot: cycle,
			actor: cycle,
			response: cycle,
			context: 'CONTEXT_PRIVATE_28',
			stack: 'STACK_PRIVATE_28'
		}
	)
	const error = new Error(`known ${dummyKey}`)
	error.stack = 'ERROR_STACK_PRIVATE_28'
	logger.exception(error, 'safe owner')
	logger.aiCall('AI_PROMPT_PRIVATE_28', 'AI_RESPONSE_PRIVATE_28', 20)
	logger.playerCommand('player', 'goal', { goal: 'PLAYER_PRIVATE_28' })
	logger.setCorrelationId(dummyKey)
	logger.debug('untagged', { source: dummyKey, model: cycle })
	const history = runtime.telemetry.getLogHistory()
	const json = JSON.stringify(history)
	for (const secret of [
		dummyKey,
		'dummy/user',
		'dummy%2Fuser',
		'dummy/password',
		'dummy%2fpassword',
		'dummy/query',
		'dummy%2Fquery',
		'dummy-fragment',
		'PROMPT_PRIVATE_28',
		'TRANSCRIPT_PRIVATE_28',
		'HEADER_PRIVATE_28',
		'CYCLIC_PRIVATE_28',
		'CONTEXT_PRIVATE_28',
		'STACK_PRIVATE_28',
		'ERROR_STACK_PRIVATE_28',
		'AI_RESPONSE_PRIVATE_28',
		'PLAYER_PRIVATE_28'
	]) {
		assert.ok(!json.includes(secret), `private fixture leaked: ${secret}`)
	}
	assert.match(history.entries[0]!.message, /https:\/\/provider\.invalid\/v1/)
	assert.match(history.entries[0]!.message, /attempt=3/)
	assert.equal(history.entries[0]?.source, 'AI')
	assert.equal(history.entries.at(-1)?.source, 'CORE')
	assert.ok(
		history.entries.every(
			entry =>
				Object.keys(entry).sort().join(',') ===
				'id,level,message,source,timestamp,truncation'
		)
	)
})

test('independent observer tokens isolate sync/async failures and prevent obsolete reentrant delivery', async t => {
	const { runtime, logger } = fixture(t)
	runtime.telemetry.subscribeLogs(() => {
		throw new Error('observer')
	})
	runtime.telemetry.subscribeLogs(async () => {
		throw new Error('async observer')
	})
	const seen: LogUpdate[] = []
	const listener = (value: LogUpdate) => {
		seen.push(value)
	}
	const first = runtime.telemetry.subscribeLogs(listener)
	const second = runtime.telemetry.subscribeLogs(listener)
	assert.equal(seen.length, 2)
	logger.info('first')
	assert.equal(seen.length, 4)
	first()
	first()
	logger.info('second')
	assert.equal(seen.length, 5)
	second()
	logger.info('disposed')
	assert.equal(seen.length, 5)
	runtime.telemetry.subscribeLogs(update => {
		if (update.kind === 'append' && update.entry.message === 'outer')
			logger.info('nested')
	})
	const revisions: number[] = []
	runtime.telemetry.subscribeLogs(update => {
		revisions.push(update.history.revision)
	})
	logger.info('outer')
	assert.deepEqual(revisions, [3, 5])
	assert.deepEqual(
		runtime.telemetry
			.getLogHistory()
			.entries.slice(-2)
			.map(entry => entry.message),
		['outer', 'nested']
	)
	await flush()
})

test('observer membership changes during delivery have defined initial-snapshot and unsubscribe behavior', async t => {
	const { runtime, logger } = fixture(t)
	let disposeOther = () => {}
	let added = false
	const late: LogUpdate[] = [],
		other: LogUpdate[] = []
	runtime.telemetry.subscribeLogs(update => {
		if (update.kind !== 'append') return
		disposeOther()
		if (!added) {
			added = true
			runtime.telemetry.subscribeLogs(value => {
				late.push(value)
			})
		}
	})
	disposeOther = runtime.telemetry.subscribeLogs(value => {
		other.push(value)
	})
	logger.info('one')
	assert.equal(other.length, 1)
	assert.deepEqual(
		late.map(value => [value.kind, value.history.revision]),
		[['snapshot', 1]]
	)
	logger.info('two')
	assert.deepEqual(
		late.map(value => [value.kind, value.history.revision]),
		[
			['snapshot', 1],
			['append', 2]
		]
	)
})

test('collection level is independent of sink/console/files and TUI-style output emits no console duplicate', async t => {
	const directory = await mkdtemp(join(tmpdir(), 'voxel-history-output-'))
	t.after(() => rm(directory, { recursive: true, force: true }))
	const sink: string[] = [],
		terminal: unknown[] = []
	t.mock.method(process.stdout, 'write', (chunk: unknown) => {
		terminal.push(chunk)
		return true
	})
	t.mock.method(process.stderr, 'write', (chunk: unknown) => {
		terminal.push(chunk)
		return true
	})
	const { runtime, logger, handle } = fixture(t, undefined, {
		console: false,
		files: {
			logFile: join(directory, 'bot.log'),
			errorLogFile: join(directory, 'error.log'),
			level: 'warn',
			maxBytes: 1024,
			maxFiles: 2
		},
		sink: {
			level: 'error',
			write: record => {
				sink.push(record.message)
			}
		}
	})
	logger.debug('debug-source-only')
	logger.info('info-source-only')
	logger.warn('warn-file')
	logger.error('error-file')
	assert.equal(runtime.telemetry.getLogHistory().entries.length, 4)
	assert.deepEqual(sink, ['error-file'])
	await runtime.stop()
	await handle.close()
	const file = await readFile(join(directory, 'bot.log'), 'utf8')
	assert.ok(file.includes('warn-file') && file.includes('error-file'))
	assert.ok(
		!file.includes('debug-source-only') && !file.includes('info-source-only')
	)
	assert.deepEqual(terminal, [])
})

test('explicit INFO collection ignores DEBUG without changing the independent raw source', async t => {
	const { runtime, logger } = fixture(t, { level: 'info' })
	const raw: string[] = []
	const dispose = logger.subscribeRecords(record => {
		raw.push(record.message)
	}, 'debug')
	logger.debug('hidden in journal')
	logger.info('retained')
	assert.deepEqual(raw, ['hidden in journal', 'retained'])
	assert.equal(runtime.telemetry.getLogHistory().revision, 1)
	assert.deepEqual(runtime.telemetry.getLogHistory().stats.acceptedByLevel, {
		debug: 0,
		info: 1,
		warn: 0,
		error: 0
	})
	dispose()
})

test('settled stop releases source/public observers and explicit restart preserves bounded history identity', async t => {
	const { runtime, logger, source } = fixture(t)
	const received: LogUpdate[] = []
	runtime.telemetry.subscribeLogs(update => {
		received.push(update)
	})
	logger.info('before stop')
	const id = runtime.telemetry.getLogHistory().id
	await runtime.stop()
	const stopped = runtime.telemetry.getLogHistory()
	const deliveries = received.length
	logger.info('app logger still owns output')
	assert.equal(runtime.telemetry.getLogHistory(), stopped)
	assert.equal(received.length, deliveries)
	let lateCalls = 0
	runtime.telemetry.subscribeLogs(() => {
		lateCalls++
	})
	assert.equal(lateCalls, 1)
	runtime.start()
	assert.equal(source.mock.callCount(), 2)
	logger.debug('after explicit restart')
	const restarted = runtime.telemetry.getLogHistory()
	assert.equal(restarted.id, id)
	assert.ok(restarted.revision > stopped.revision)
	assert.ok(
		restarted.entries.some(entry => entry.id === stopped.entries[0]?.id)
	)
	assert.equal(received.length, deliveries)
	assert.equal(lateCalls, 1)
	assert.equal(restarted.entries.at(-1)?.message, 'after explicit restart')
	await runtime.stop()
})

test('deadline detaches logging only when public stop settles, while pending persistence stays owned', async t => {
	t.mock.timers.enable({ apis: ['Date', 'setTimeout', 'setInterval'] })
	const { runtime, logger, bots, save } = fixture(t)
	runtime.start()
	bots[0]!.emit('botReady')
	await flush()
	assert.equal(runtime.telemetry.getSnapshot().connection.state, 'ready')
	let resolve!: () => void
	const pending = new Promise<void>(done => {
		resolve = done
	})
	save.mock.mockImplementation(() => pending)
	const stop = runtime.stop()
	logger.info('during persistence')
	assert.equal(
		runtime.telemetry.getLogHistory().entries.at(-1)?.message,
		'during persistence'
	)
	t.mock.timers.tick(100)
	assert.equal((await stop).outcome, 'timed-out')
	const final = runtime.telemetry.getLogHistory()
	logger.info('late cleanup log')
	assert.equal(runtime.telemetry.getLogHistory(), final)
	resolve()
	await flush()
})

test('separate runtime journals isolate source records, IDs, retained objects and configured credentials', async t => {
	const first = fixture(t, undefined, undefined, 'FIRST_PRIVATE_KEY_28')
	const second = fixture(t, undefined, undefined, 'SECOND_PRIVATE_KEY_28')
	first.logger.info('first FIRST_PRIVATE_KEY_28')
	second.logger.info('second SECOND_PRIVATE_KEY_28')
	const a = first.runtime.telemetry.getLogHistory(),
		b = second.runtime.telemetry.getLogHistory()
	assert.notEqual(a.id, b.id)
	assert.equal(a.entries.length, 1)
	assert.equal(b.entries.length, 1)
	assert.equal(a.entries[0]?.message, 'first <REDACTED>')
	assert.equal(b.entries[0]?.message, 'second <REDACTED>')
	assert.notEqual(a.entries[0], b.entries[0])
	await first.runtime.stop()
	second.logger.info('second still active')
	assert.equal(second.runtime.telemetry.getLogHistory().revision, 2)
	assert.equal(first.runtime.telemetry.getLogHistory(), a)
})

test('invalid finite journal policies reject before logger subscription or native owner startup', async t => {
	const { services, source, bots } = fixture(t)
	const initialSubscriptions = source.mock.callCount()
	for (const logs of [
		{ maxEntries: 0 },
		{ maxEntries: NaN },
		{ maxBytes: Infinity },
		{ maxBytes: 255 },
		{ maxEntryBytes: -1 }
	]) {
		assert.throws(
			() => createBotRuntime(services, { logs }),
			/Log history limits/
		)
	}
	assert.equal(source.mock.callCount(), initialSubscriptions)
	assert.equal(bots.length, 0)
})
