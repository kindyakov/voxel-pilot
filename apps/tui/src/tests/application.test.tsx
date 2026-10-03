import assert from 'node:assert/strict'
import test from 'node:test'
import { setImmediate as flushEffects } from 'node:timers/promises'

import type { StopResult } from '@voxel-pilot/contracts'

import {
	type TuiApplicationOptions,
	startTuiApplication
} from '../app/application.js'
import { ManualClock } from './fixtures/clock.js'
import { deferred, publicRuntime, saved } from './fixtures/runtime.js'
import { Input, Output } from './fixtures/terminal.js'

function fixture(
	t: test.TestContext,
	options: Partial<TuiApplicationOptions> = {}
) {
	const source = publicRuntime()
	source.append('initial INFO')
	source.append('collected DEBUG', 'debug')
	const stdin = new Input(),
		stdout = new Output(),
		stderr = new Output()
	const clock = new ManualClock()
	const beforeExitListeners = process.listenerCount('beforeExit')
	let closeCalls = 0
	let close: () => Promise<void> = async () => {}
	const app = startTuiApplication({
		streams: { stdin, stdout, stderr },
		signals: source.signals,
		clock,
		capabilities: { color: false, unicode: true },
		displayClock: { formatTimestamp: () => '12:34:56' },
		shutdownTimeoutMs: 100,
		compose: () => ({
			runtime: source.runtime,
			loggerHandle: {
				close() {
					closeCalls++
					return close()
				}
			}
		}),
		...options
	})
	t.after(async () => {
		void app.shutdown()
		clock.advance(100)
		stdout.release()
		await app.done
		await flushEffects()
		assert.equal(process.listenerCount('beforeExit'), beforeExitListeners)
		stdin.destroy()
		stdout.destroy()
		stderr.destroy()
	})
	return {
		...source,
		app,
		stdin,
		stdout,
		stderr,
		clock,
		closeCalls: () => closeCalls,
		loggerClose(value: () => Promise<void>) {
			close = value
		}
	}
}

test('unsupported input/output rejects before composition, raw input or runtime allocation', () => {
	for (const missing of ['input', 'output', 'raw'] as const) {
		const stdin = new Input(),
			stdout = new Output(),
			stderr = new Output()
		if (missing === 'input') stdin.isTTY = false
		if (missing === 'output') stdout.isTTY = false
		if (missing === 'raw')
			Object.defineProperty(stdin, 'setRawMode', { value: undefined })
		let allocations = 0
		assert.throws(
			() =>
				startTuiApplication({
					streams: { stdin, stdout, stderr },
					compose() {
						allocations++
						throw new Error('must not allocate')
					}
				}),
			/interactive terminal.*pnpm start/
		)
		assert.equal(allocations, 0)
		assert.deepEqual(stdin.rawCalls, [])
		assert.equal(stdout.chunks.length, 0)
		stdin.destroy()
		stdout.destroy()
		stderr.destroy()
	}
})

test('invalid application deadline rejects before composition and terminal writes', () => {
	const stdin = new Input(),
		stdout = new Output(),
		stderr = new Output()
	let allocations = 0
	for (const shutdownTimeoutMs of [0, -1, 0.5, Infinity, 2_147_483_648]) {
		assert.throws(
			() =>
				startTuiApplication({
					streams: { stdin, stdout, stderr },
					shutdownTimeoutMs,
					compose() {
						allocations++
						throw new Error('must not compose')
					}
				}),
			/shutdownTimeoutMs/
		)
	}
	assert.equal(allocations, 0)
	assert.deepEqual(stdin.rawCalls, [])
	assert.equal(stdout.chunks.length, 0)
	stdin.destroy()
	stdout.destroy()
	stderr.destroy()
})

test('native shutdown restores an initially raw input stream after unmount cleanup', async t => {
	const source = publicRuntime(),
		stdin = new Input(),
		stdout = new Output(),
		stderr = new Output()
	stdin.isRaw = true
	const app = startTuiApplication({
		streams: { stdin, stdout, stderr },
		signals: source.signals,
		compose: () => ({
			runtime: source.runtime,
			loggerHandle: { async close() {} }
		})
	})
	t.after(() => {
		stdin.destroy()
		stdout.destroy()
		stderr.destroy()
	})
	await app.ready
	stdin.send('q')
	assert.equal((await app.done).exitCode, 0)
	await flushEffects()
	assert.equal(stdin.isRaw, true)
	assert.match(stdout.acknowledged.join(''), /\u001b\[\?1049l\u001b\[\?25h/)
})

test('failed raw restoration reports incomplete terminal cleanup after the sole runtime stop', async t => {
	const source = publicRuntime(),
		stdin = new Input(),
		stdout = new Output(),
		stderr = new Output()
	const app = startTuiApplication({
		streams: { stdin, stdout, stderr },
		signals: source.signals,
		compose: () => ({
			runtime: source.runtime,
			loggerHandle: { async close() {} }
		})
	})
	t.after(() => {
		stdin.destroy()
		stdout.destroy()
		stderr.destroy()
	})
	await app.ready
	t.mock.method(stdin, 'setRawMode', () => {
		throw new Error('private restoration fixture')
	})
	const result = await app.shutdown()
	assert.equal(result.exitCode, 1)
	assert.equal(result.issues[0]?.code, 'terminal-close-failed')
	assert.equal(result.runtime?.persistence, 'saved')
	assert.equal(source.counts().stopCalls, 1)
	assert.equal(stdin.isRaw, true)
	assert.equal(stdin.listenerCount('readable'), 0)
	assert.equal(stdout.listenerCount('resize'), 0)
	assert.equal(source.counts().activeSnapshots + source.counts().activeLogs, 0)
	assert.ok(!stderr.text().includes('private restoration fixture'))
})

test('native Ink displays public connection and INFO+ rows while one bridge owns current references', async t => {
	const f = fixture(t)
	await f.app.ready
	f.connection('ready')
	f.append('new WARN', 'warn')
	await f.app.flush()
	const output = f.stdout.text()
	for (const value of [
		'VoxelPilot',
		'READY',
		'12:34:56',
		'INFO',
		'CORE',
		'initial INFO',
		'new WARN',
		'Ctrl+C'
	])
		assert.ok(output.includes(value), value)
	assert.ok(!output.includes('collected DEBUG'))
	assert.equal(f.stdin.isRaw, true)
	assert.deepEqual(f.counts(), {
		startCalls: 1,
		stopCalls: 0,
		snapshotSubscriptions: 1,
		logSubscriptions: 1,
		activeSnapshots: 1,
		activeLogs: 1
	})
	f.stdin.send('q')
	const result = await f.app.done
	assert.equal(result.exitCode, 0)
	assert.equal(result.runtime?.persistence, 'saved')
	assert.equal(f.closeCalls(), 1)
	assert.equal(f.stdin.isRaw, false)
	assert.equal(f.stdin.listenerCount('readable'), 0)
	assert.equal(f.stdout.listenerCount('resize'), 0)
	assert.equal(f.counts().activeLogs + f.counts().activeSnapshots, 0)
	assert.match(f.stdout.chunks.join(''), /\u001b\[\?1049l/)
	assert.match(f.stdout.acknowledged.join(''), /\u001b\[\?1049l\u001b\[\?25h/)
})

test('q, raw Ctrl+C and signals join one stop and wait for held persistence before terminal teardown', async t => {
	const f = fixture(t)
	const stop = deferred<StopResult>()
	f.holdStop(stop.promise)
	await f.app.ready
	f.stdin.send('q')
	await f.stopStarted.promise
	const joined = f.app.shutdown()
	assert.equal(joined, f.app.shutdown())
	f.stdin.send('\u0003')
	f.signals.emit('SIGTERM')
	await f.app.flush()
	assert.match(f.stdout.text(), /Stopping.*awaiting persistence/)
	assert.match(f.stdout.text(), /deadline 0\.1s/)
	assert.equal(f.stdin.isRaw, true)
	assert.equal(f.counts().stopCalls, 1)
	assert.equal(f.closeCalls(), 0)
	let completed = false
	void f.app.done.then(() => {
		completed = true
	})
	await flushEffects()
	assert.equal(completed, false)
	stop.resolve(saved)
	const result = await joined
	assert.equal(result.exitCode, 0)
	assert.equal(f.closeCalls(), 1)
	assert.equal(
		f.signals.listenerCount('SIGINT') + f.signals.listenerCount('SIGTERM'),
		0
	)
	assert.equal(f.clock.pending, 0)
})

test('raw Ctrl+C reaches shared shutdown without a process signal', async t => {
	const f = fixture(t)
	await f.app.ready
	f.stdin.send('\u0003')
	assert.equal((await f.app.done).exitCode, 0)
	assert.equal(f.counts().stopCalls, 1)
})

test('exit before initial output flush fences a late start and waits only until the actual deadline', async t => {
	const source = publicRuntime(),
		stdin = new Input(),
		stdout = new Output(),
		stderr = new Output()
	stdout.hold = true
	const clock = new ManualClock()
	let closeCalls = 0
	const app = startTuiApplication({
		streams: { stdin, stdout, stderr },
		signals: source.signals,
		clock,
		shutdownTimeoutMs: 100,
		compose: () => ({
			runtime: source.runtime,
			loggerHandle: {
				async close() {
					closeCalls++
				}
			}
		})
	})
	t.after(() => {
		stdout.release()
		stdin.destroy()
		stdout.destroy()
		stderr.destroy()
	})
	await stdin.rawEnabled
	stdin.send('q')
	await source.stopStarted.promise
	assert.equal(source.counts().startCalls, 0)
	clock.advance(100)
	const result = await app.done
	assert.equal(result.exitCode, 1)
	assert.equal(result.issues[0]?.code, 'application-shutdown-deadline')
	assert.equal(stdin.isRaw, false)
	stdout.release()
	await app.ready
	assert.equal(source.counts().startCalls, 0)
	assert.equal(closeCalls, 1)
})

test('pending save reaches finite deadline, retains fixed incomplete result and ignores late outcomes', async t => {
	const f = fixture(t),
		stop = deferred<StopResult>()
	f.holdStop(stop.promise)
	await f.app.ready
	const pending = f.app.shutdown()
	await f.app.flush()
	f.clock.advance(99)
	let complete = false
	void pending.then(() => {
		complete = true
	})
	await flushEffects()
	assert.equal(complete, false)
	f.clock.advance(1)
	const result = await pending
	assert.equal(result.exitCode, 1)
	assert.equal(result.runtime, null)
	assert.equal(result.issues[0]?.code, 'application-shutdown-deadline')
	assert.match(f.stderr.text(), /persistence.*incomplete/)
	assert.equal(f.stdin.isRaw, false)
	assert.equal(f.closeCalls(), 1)
	assert.equal(f.counts().activeLogs + f.counts().activeSnapshots, 0)
	stop.resolve(saved)
	await flushEffects()
	assert.equal(await f.app.done, result)
	assert.equal(f.counts().startCalls, 1)
})

test('runtime timeout/failed-save reports remain nonzero through terminal restoration', async t => {
	for (const result of [
		{ outcome: 'timed-out', persistence: 'incomplete', issues: [] },
		{ outcome: 'failed', persistence: 'failed', issues: [] }
	] satisfies StopResult[]) {
		const f = fixture(t)
		f.holdStop(Promise.resolve(result))
		await f.app.ready
		const stopped = await f.app.shutdown()
		assert.equal(stopped.exitCode, 1)
		assert.equal(stopped.runtime, result)
		assert.equal(f.stdin.isRaw, false)
		assert.match(f.stderr.text(), /persistence may be incomplete/)
	}
})

test('logger failure and hung logger remain finite and restore terminal after runtime stop', async t => {
	const failed = fixture(t)
	failed.loggerClose(async () => {
		throw new Error('private fixture error not displayed')
	})
	await failed.app.ready
	const failure = await failed.app.shutdown()
	assert.equal(failure.exitCode, 1)
	assert.equal(failure.issues[0]?.code, 'logger-close-failed')
	assert.equal(failed.stdin.isRaw, false)
	assert.ok(!failed.stderr.text().includes('private fixture'))
	const hung = fixture(t),
		pending = deferred<void>()
	hung.loggerClose(() => pending.promise)
	await hung.app.ready
	void hung.app.shutdown()
	await hung.stopStarted.promise
	await flushEffects()
	hung.clock.advance(100)
	const timeout = await hung.app.done
	assert.equal(timeout.exitCode, 1)
	assert.equal(timeout.runtime?.persistence, 'saved')
	assert.equal(hung.stdin.isRaw, false)
	pending.resolve()
	await flushEffects()
	assert.equal(await hung.app.done, timeout)
	assert.equal(hung.closeCalls(), 1)
})

test('final connection failure and prior journal remain visible until explicit exit', async t => {
	const f = fixture(t)
	await f.app.ready
	f.connection('failed', {
		code: 'retry-exhausted',
		message: 'Connection retries exhausted'
	})
	f.append('final connection error', 'error')
	await f.app.flush()
	assert.match(f.stdout.text(), /Connection retries exhausted/)
	assert.match(f.stdout.text(), /final connection error/)
	assert.equal(f.counts().stopCalls, 0)
	assert.equal(f.counts().startCalls, 1)
	f.stdin.send('q')
	assert.equal((await f.app.done).exitCode, 1)
})

test('resize including tiny/failure screens retains one runtime and always-mounted exit input', async t => {
	const f = fixture(t)
	await f.app.ready
	f.stdout.resize(35, 6)
	await f.app.flush()
	assert.match(f.stdout.text(), /Увеличьте окно/)
	f.stdout.resize(100, 24)
	f.connection('failed', { code: 'failure', message: 'Still visible' })
	await f.app.flush()
	assert.match(f.stdout.text(), /Still visible/)
	f.stdout.resize(35, 6)
	await f.app.flush()
	f.stdin.send('\u0003')
	await f.app.done
	assert.equal(f.counts().startCalls, 1)
	assert.equal(f.counts().snapshotSubscriptions, 1)
	assert.equal(f.counts().logSubscriptions, 1)
	assert.equal(f.stdin.rawCalls.filter(Boolean).length, 1)
})

test('feature rendering failure preserves connection and input without stopping gameplay', async t => {
	const f = fixture(t, {
		displayClock: {
			formatTimestamp() {
				throw new Error('private widget fixture')
			}
		}
	})
	await f.app.ready
	f.connection('ready')
	await f.app.flush()
	assert.match(f.stdout.text(), /Log view unavailable/)
	assert.match(f.stdout.text(), /READY/)
	assert.equal(f.counts().stopCalls, 0)
	assert.ok(!f.stdout.text().includes('private widget fixture'))
	f.stdin.send('q')
	assert.equal((await f.app.done).exitCode, 0)
})

test('fatal root view and actual raw-enable failure join finite stop without starting the runtime', async t => {
	const root = fixture(t, {
		view() {
			throw new Error('private root fixture')
		}
	})
	const result = await root.app.done
	assert.equal(result.exitCode, 1)
	assert.equal(root.counts().startCalls, 0)
	assert.equal(root.counts().stopCalls, 1)
	assert.equal(root.stdin.isRaw, false)
	assert.ok(!root.stdout.text().includes('private root fixture'))
	const source = publicRuntime(),
		stdin = new Input(),
		stdout = new Output(),
		stderr = new Output()
	stdin.failRaw = true
	const app = startTuiApplication({
		streams: { stdin, stdout, stderr },
		signals: source.signals,
		compose: () => ({
			runtime: source.runtime,
			loggerHandle: { async close() {} }
		})
	})
	t.after(() => {
		stdin.destroy()
		stdout.destroy()
		stderr.destroy()
	})
	const rawFailure = await app.done
	assert.equal(rawFailure.exitCode, 1)
	assert.equal(source.counts().startCalls, 0)
	assert.equal(source.counts().stopCalls, 1)
	assert.equal(stdin.isRaw, false)
})

test('terminal write failure is fatal and still restores input and releases public observation', async t => {
	const source = publicRuntime(),
		stdin = new Input(),
		stdout = new Output(),
		stderr = new Output()
	stdout.failWrite = true
	const clock = new ManualClock()
	const app = startTuiApplication({
		streams: { stdin, stdout, stderr },
		signals: source.signals,
		clock,
		compose: () => ({
			runtime: source.runtime,
			loggerHandle: { async close() {} }
		})
	})
	t.after(() => {
		stdin.destroy()
		stdout.destroy()
		stderr.destroy()
	})
	await source.stopStarted.promise
	clock.advance(15000)
	assert.equal((await app.done).exitCode, 1)
	assert.equal(source.counts().startCalls, 0)
	assert.equal(source.counts().activeLogs + source.counts().activeSnapshots, 0)
	assert.equal(stdin.isRaw, false)
})

test('display neutralizes embedded terminal/line controls while retaining portable source records', async t => {
	const f = fixture(t)
	await f.app.ready
	f.append('safe <REDACTED> \u001b]0;injected\u0007\nnext\rline', 'error')
	const source = f.runtime.telemetry.getLogHistory()
	await f.app.flush()
	const output = f.stdout.chunks.join('')
	assert.ok(!output.includes('\u001b]0;injected'))
	assert.match(f.stdout.text(), /\\u001b\]0;injected/)
	assert.equal(f.runtime.telemetry.getLogHistory(), source)
	f.stdin.send('q')
	await f.app.done
})

test('normal completion waits for genuine terminal write acknowledgement before resolving done', async t => {
	const f = fixture(t)
	await f.app.ready
	f.stdout.hold = true
	const pending = f.app.shutdown()
	await f.stopStarted.promise
	let complete = false
	void pending.then(() => {
		complete = true
	})
	await flushEffects()
	assert.equal(complete, false)
	assert.equal(f.stdin.isRaw, true)
	f.stdout.release()
	const result = await pending
	assert.equal(result.exitCode, 0)
	assert.equal(f.stdin.isRaw, false)
	assert.match(f.stdout.acknowledged.join(''), /\u001b\[\?1049l\u001b\[\?25h/)
})

test('fatal mounting with held output stays bounded, restores raw input and acknowledges output only after release', async t => {
	const source = publicRuntime(),
		stdin = new Input(),
		stdout = new Output(),
		stderr = new Output()
	const clock = new ManualClock()
	stdout.hold = true
	let closeCalls = 0
	const app = startTuiApplication({
		streams: { stdin, stdout, stderr },
		signals: source.signals,
		clock,
		shutdownTimeoutMs: 100,
		view() {
			throw new Error('private fatal fixture')
		},
		compose: () => ({
			runtime: source.runtime,
			loggerHandle: {
				async close() {
					closeCalls++
				}
			}
		})
	})
	t.after(() => {
		stdout.release()
		stdin.destroy()
		stdout.destroy()
		stderr.destroy()
	})
	await source.stopStarted.promise
	clock.advance(100)
	const result = await app.done
	assert.equal(result.exitCode, 1)
	assert.equal(stdin.isRaw, false)
	assert.equal(source.counts().activeSnapshots + source.counts().activeLogs, 0)
	assert.equal(source.counts().startCalls, 0)
	assert.equal(closeCalls, 1)
	assert.ok(!stdout.acknowledged.join('').includes('\u001b[?1049l'))
	assert.match(stderr.text(), /shutdown deadline.*incomplete/i)
	stdout.release()
	await app.ready
	assert.match(stdout.acknowledged.join(''), /\u001b\[\?1049l\u001b\[\?25h/)
	assert.equal(await app.done, result)
})

test('runtime stop rejection is safely reported and a late rejection cannot overwrite deadline completion', async t => {
	for (const late of [false, true]) {
		const f = fixture(t),
			stop = deferred<StopResult>()
		f.holdStop(stop.promise)
		await f.app.ready
		const pending = f.app.shutdown()
		if (late) f.clock.advance(100)
		stop.reject(new Error('private runtime stop fixture'))
		const result = await pending
		assert.equal(result.exitCode, 1)
		assert.equal(
			result.issues[0]?.code,
			late ? 'application-shutdown-deadline' : 'runtime-stop-failed'
		)
		await flushEffects()
		assert.equal(await f.app.done, result)
		assert.ok(!f.stderr.text().includes('private runtime stop fixture'))
		assert.equal(f.closeCalls(), 1)
	}
})

test('initial subscription failure closes inert resources and removes the partial source without starting', async t => {
	const source = publicRuntime(),
		stdin = new Input(),
		stdout = new Output(),
		stderr = new Output()
	let closeCalls = 0
	const app = startTuiApplication({
		streams: { stdin, stdout, stderr },
		signals: source.signals,
		compose: () => ({
			runtime: {
				...source.runtime,
				telemetry: {
					...source.runtime.telemetry,
					subscribeLogs() {
						throw new Error('private subscription fixture')
					}
				}
			},
			loggerHandle: {
				async close() {
					closeCalls++
				}
			}
		})
	})
	t.after(() => {
		stdin.destroy()
		stdout.destroy()
		stderr.destroy()
	})
	assert.equal((await app.done).exitCode, 1)
	assert.equal(source.counts().startCalls, 0)
	assert.equal(source.counts().stopCalls, 1)
	assert.equal(source.counts().activeSnapshots + source.counts().activeLogs, 0)
	assert.equal(closeCalls, 1)
	assert.deepEqual(stdin.rawCalls, [])
	assert.ok(!stderr.text().includes('private subscription fixture'))
})
