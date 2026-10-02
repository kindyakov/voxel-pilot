import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'
import { setImmediate as flush } from 'node:timers/promises'

import type {
	BotRuntime,
	BotSnapshot,
	LogHistory,
	StopResult
} from '@voxel-pilot/contracts'
import { createRuntimeLogger } from '@voxel-pilot/core/services'

import { startCliApplication } from '../application.js'
import { createCliRuntime } from '../bootstrap.js'

const unknown = Object.freeze({ value: null, updatedAt: null, stale: false })
const stopped: StopResult = Object.freeze({
	outcome: 'stopped',
	persistence: 'not-required',
	issues: []
})

function deferred() {
	let resolve!: () => void
	const promise = new Promise<void>(done => {
		resolve = done
	})
	return { promise, resolve }
}

function fixture(t: test.TestContext) {
	t.mock.timers.enable({ apis: ['Date', 'setTimeout', 'setInterval'] })
	const handle = createRuntimeLogger({
		aiModel: 'application-fixture',
		console: false,
		files: false
	})
	t.after(() => handle.close())
	const signals = new EventEmitter()
	const listeners = new Set<(snapshot: BotSnapshot) => void>()
	const snapshot: BotSnapshot = {
		revision: 0,
		connection: {
			state: 'idle',
			changedAt: 0,
			sessionId: null,
			retryAttempt: 0,
			retryAt: null,
			failure: null
		},
		health: unknown,
		maxHealth: unknown,
		food: unknown,
		position: unknown,
		harness: unknown
	}
	const start = t.mock.fn(() => {
		assert.equal(signals.listenerCount('SIGINT'), 1)
		assert.equal(signals.listenerCount('SIGTERM'), 1)
		assert.equal(listeners.size, 1)
	})
	const stop = t.mock.fn(async (): Promise<StopResult> => stopped)
	const runtime: BotRuntime = {
		start,
		stop,
		telemetry: {
			getLogHistory(): LogHistory {
				return {
					id: 'application-fixture',
					revision: 0,
					level: 'debug',
					limits: { maxEntries: 1, maxBytes: 256, maxEntryBytes: 256 },
					entries: [],
					stats: {
						retainedEntries: 0,
						retainedBytes: 0,
						acceptedEntries: 0,
						acceptedByLevel: { debug: 0, info: 0, warn: 0, error: 0 },
						evictedEntries: 0,
						evictedBytes: 0,
						truncatedEntries: 0
					}
				}
			},
			subscribeLogs(listener) {
				listener({ kind: 'snapshot', history: this.getLogHistory() })
				return () => {}
			},
			getSnapshot: () => snapshot,
			subscribe(listener) {
				listeners.add(listener)
				listener(snapshot)
				return () => {
					listeners.delete(listener)
				}
			}
		}
	}
	const exits: number[] = [],
		messages: string[] = []
	const close = t.mock.fn(() => handle.close())
	const options = {
		runtime,
		loggerHandle: { logger: handle.logger, close },
		signals,
		exit: (code: number) => {
			exits.push(code)
		},
		report: (message: string) => {
			messages.push(message)
		},
		shutdownTimeoutMs: 1000
	}
	const fail = () => {
		for (const listener of listeners)
			listener({
				...snapshot,
				connection: {
					...snapshot.connection,
					state: 'failed',
					failure: {
						code: 'connection-retries-exhausted',
						message: 'Final connection failure.'
					}
				}
			})
	}
	return {
		options,
		signals,
		runtime,
		start,
		stop,
		close,
		exits,
		messages,
		listeners,
		fail
	}
}

test('signals are installed before start and repeated exit requests join runtime then caller logger close', async t => {
	const { options, signals, stop, close, exits, listeners } = fixture(t)
	const closing = deferred()
	close.mock.mockImplementation(() => closing.promise)
	const app = startCliApplication(options)
	signals.emit('SIGINT')
	signals.emit('SIGTERM')
	const shutdown = app.shutdown()
	assert.equal(app.shutdown(), shutdown)
	await flush()
	assert.equal(stop.mock.callCount(), 1)
	assert.equal(close.mock.callCount(), 1)
	assert.deepEqual(exits, [])
	closing.resolve()
	assert.equal((await shutdown).exitCode, 0)
	assert.deepEqual(exits, [0])
	assert.equal(listeners.size, 0)
	assert.equal(signals.listenerCount('SIGINT'), 0)
	assert.equal(signals.listenerCount('SIGTERM'), 0)
})

test('terminal connection failure uses the shared shutdown and preserves a nonzero exit despite successful cleanup', async t => {
	const { options, fail, stop, close, exits } = fixture(t)
	const app = startCliApplication(options)
	fail()
	const result = await app.shutdown()
	assert.equal(result.exitCode, 1)
	assert.equal(result.runtime?.outcome, 'stopped')
	assert.equal(stop.mock.callCount(), 1)
	assert.equal(close.mock.callCount(), 1)
	assert.deepEqual(exits, [1])
})

for (const stage of ['runtime', 'logger'] as const) {
	test(`whole application deadline remains finite when ${stage} completion hangs`, async t => {
		const { options, stop, close, exits, messages, signals } = fixture(t)
		const pending = deferred()
		if (stage === 'runtime')
			stop.mock.mockImplementation(async () => {
				await pending.promise
				return stopped
			})
		else close.mock.mockImplementation(() => pending.promise)
		const app = startCliApplication(options)
		const shutdown = app.shutdown()
		await flush()
		t.mock.timers.tick(999)
		await flush()
		assert.deepEqual(exits, [])
		t.mock.timers.tick(1)
		assert.equal((await shutdown).exitCode, 1)
		assert.equal(
			(await shutdown).issues[0]?.code,
			'application-shutdown-deadline'
		)
		assert.match(messages.at(-1)!, /may be incomplete/)
		assert.equal(signals.listenerCount('SIGINT'), 0)
		assert.equal(app.shutdown(), shutdown)
		pending.resolve()
		await flush()
		assert.deepEqual(
			exits,
			[1],
			'late settlement cannot exit twice or change the outcome'
		)
	})
}

test('logger failure is safely reported, finite and nonzero after runtime cleanup', async t => {
	const { options, close, exits, messages } = fixture(t)
	close.mock.mockImplementation(async () => {
		throw new Error('secret log output marker')
	})
	const result = await startCliApplication(options).shutdown()
	assert.equal(result.exitCode, 1)
	assert.equal(result.issues[0]?.code, 'logger-close-failed')
	assert.ok(!JSON.stringify(result).includes('secret log output marker'))
	assert.ok(!messages.join().includes('secret log output marker'))
	assert.deepEqual(exits, [1])
})

test('runtime failed report causes nonzero exit and reporting failures cannot block shutdown', async t => {
	const { options, stop, close, exits } = fixture(t)
	stop.mock.mockImplementation(async () => ({
		outcome: 'timed-out',
		persistence: 'incomplete',
		issues: [
			{
				stage: 'deadline',
				code: 'stop-deadline-exceeded',
				message: 'Saving may be incomplete.'
			}
		]
	}))
	const result = await startCliApplication({
		...options,
		report() {
			throw new Error('reporter')
		}
	}).shutdown()
	assert.equal(result.exitCode, 1)
	assert.equal(result.runtime?.persistence, 'incomplete')
	assert.equal(close.mock.callCount(), 1)
	assert.deepEqual(exits, [1])
})

test('invalid application deadlines are rejected before installing listeners or starting', t => {
	const { options, start, signals } = fixture(t)
	for (const shutdownTimeoutMs of [0, -1, Infinity, NaN, 0.5, 2_147_483_648]) {
		assert.throws(
			() => startCliApplication({ ...options, shutdownTimeoutMs }),
			/shutdownTimeoutMs/
		)
	}
	assert.equal(start.mock.callCount(), 0)
	assert.equal(signals.listenerCount('SIGINT'), 0)
})

test('the real portable runtime retry exhaustion drives CLI cleanup and nonzero exit', async t => {
	t.mock.timers.enable({ apis: ['Date', 'setTimeout', 'setInterval'] })
	let attempts = 0
	const app = createCliRuntime({
		environment: {
			MINECRAFT_HOST: 'localhost',
			MINECRAFT_PORT: '25565',
			MINECRAFT_USERNAME: 'failed-cli-fixture',
			MINECRAFT_VERSION: '1.20.4',
			AI_PROVIDER: 'disabled',
			AI_MODEL: 'fixture'
		},
		settingsFile: null,
		output: { console: false, files: false },
		connection: {
			createBot() {
				attempts++
				throw new Error('private failure')
			}
		}
	})
	const exits: number[] = []
	const owner = startCliApplication({
		...app,
		signals: new EventEmitter(),
		exit: code => {
			exits.push(code)
		},
		report: () => {}
	})
	for (const delay of [3000, 6000, 12000, 24000, 48000])
		t.mock.timers.tick(delay)
	assert.equal(attempts, 6)
	assert.equal((await owner.shutdown()).exitCode, 1)
	assert.deepEqual(exits, [1])
	assert.equal(
		app.runtime.telemetry.getSnapshot().connection.failure?.code,
		'connection-retries-exhausted'
	)
	t.mock.timers.tick(300_000)
	assert.equal(attempts, 6)
})
