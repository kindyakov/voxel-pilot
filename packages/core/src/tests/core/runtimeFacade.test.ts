import assert from 'node:assert/strict'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { setImmediate as flush } from 'node:timers/promises'

import type { BotSnapshot, StopResult } from '@voxel-pilot/contracts'

import {
	createRuntimeConfigFromEnvironment,
	createRuntimeLogger,
	createRuntimeServices
} from '../../config/services.js'
import { MemoryManager } from '../../core/memory/index.js'
import { ProfileMemoryStore } from '../../core/profile/index.js'
import { createBotRuntime } from '../../core/runtime.js'
import { createRuntimeConnectionBot } from './fixtures/runtimeBot.js'

function deferred() {
	let resolve!: () => void
	const promise = new Promise<void>(done => {
		resolve = done
	})
	return { promise, resolve }
}

function fixture(t: test.TestContext, timeout = 1000, createFails = false) {
	t.mock.timers.enable({ apis: ['Date', 'setTimeout', 'setInterval'] })
	const handle = createRuntimeLogger({
		aiModel: 'fixture',
		console: false,
		files: false
	})
	const config = createRuntimeConfigFromEnvironment(
		{
			MINECRAFT_HOST: 'localhost',
			MINECRAFT_PORT: '25565',
			MINECRAFT_USERNAME: 'facade-fixture',
			MINECRAFT_VERSION: '1.20.4',
			AI_PROVIDER: 'disabled',
			AI_MODEL: 'fixture'
		},
		{
			settingsFile: null,
			memoryDir: tmpdir(),
			profileDir: tmpdir(),
			logFile: join(tmpdir(), 'unused.log'),
			errorLogFile: join(tmpdir(), 'unused-error.log'),
			aiRequestDumpDir: tmpdir()
		}
	)
	const services = createRuntimeServices({ config, logger: handle.logger })
	const load = t.mock.method(MemoryManager.prototype, 'load', async () => {})
	const save = t.mock.method(MemoryManager.prototype, 'save', async () => {})
	const close = t.mock.method(MemoryManager.prototype, 'close', () => {})
	const profileLoad = t.mock.method(
		ProfileMemoryStore.prototype,
		'load',
		async () => {}
	)
	const profileClose = t.mock.method(
		ProfileMemoryStore.prototype,
		'close',
		() => {}
	)
	const bots: ReturnType<typeof createRuntimeConnectionBot>[] = []
	let attempts = 0,
		cleanups = 0
	const runtime = createBotRuntime(services, {
		stopTimeoutMs: timeout,
		connection: {
			createBot() {
				attempts++
				if (createFails) throw new Error('private failure marker')
				const bot = createRuntimeConnectionBot()
				bots.push(bot)
				return bot.asBot()
			},
			initConnection: () => () => {
				cleanups++
			}
		}
	})
	t.after(async () => {
		await handle.close()
	})
	return {
		runtime,
		services,
		bots,
		load,
		save,
		close,
		profileLoad,
		profileClose,
		attempts: () => attempts,
		cleanups: () => cleanups
	}
}

test('facade is inert, frozen and supplies cached complete unknown snapshots with isolated observers', async t => {
	const { runtime, attempts } = fixture(t)
	assert.deepEqual(Object.keys(runtime).sort(), ['start', 'stop', 'telemetry'])
	assert.deepEqual(Object.keys(runtime.telemetry).sort(), [
		'getSnapshot',
		'subscribe'
	])
	assert.ok(Object.isFrozen(runtime) && Object.isFrozen(runtime.telemetry))
	const first = runtime.telemetry.getSnapshot()
	assert.equal(runtime.telemetry.getSnapshot(), first)
	assert.equal(attempts(), 0)
	for (const key of [
		'health',
		'maxHealth',
		'food',
		'position',
		'harness'
	] as const) {
		assert.deepEqual(first[key], { value: null, updatedAt: null, stale: false })
		assert.ok(Object.isFrozen(first[key]))
	}
	assert.ok(Object.isFrozen(first) && Object.isFrozen(first.connection))
	assert.deepEqual(JSON.parse(JSON.stringify(first)), first)
	const received: BotSnapshot[] = []
	runtime.telemetry.subscribe(() => {
		throw new Error('observer')
	})
	runtime.telemetry.subscribe(async () => {
		throw new Error('async observer')
	})
	const listen = (value: BotSnapshot) => {
		received.push(value)
	}
	const disposeFirst = runtime.telemetry.subscribe(listen)
	const disposeSecond = runtime.telemetry.subscribe(listen)
	assert.deepEqual(received, [first, first])
	disposeFirst()
	disposeFirst()
	runtime.start()
	runtime.start()
	assert.equal(attempts(), 1)
	assert.equal(received.length, 3)
	assert.equal(received[2]?.connection.state, 'connecting')
	disposeSecond()
	await runtime.stop()
	assert.equal(received.length, 3)
	await flush()
})

test('reentrant stop on connecting prevents native creation and start; stopping joins memoized promise', async t => {
	const { runtime, attempts } = fixture(t)
	let stopped: Promise<StopResult> | undefined
	let joined: Promise<StopResult> | undefined
	const revisions: number[] = []
	runtime.telemetry.subscribe(snapshot => {
		if (snapshot.connection.state === 'connecting') stopped = runtime.stop()
		if (snapshot.connection.state === 'stopping') {
			joined = runtime.stop()
			runtime.start()
		}
	})
	runtime.telemetry.subscribe(snapshot => {
		revisions.push(snapshot.revision)
	})
	runtime.start()
	assert.equal(attempts(), 0)
	assert.equal(stopped, joined)
	assert.equal((await stopped)?.outcome, 'stopped')
	assert.ok(
		revisions.every(
			(revision, index) => index === 0 || revision > revisions[index - 1]!
		)
	)
})

test('ready means actual harness readiness and a reentrant stop cannot announce chat or restore timers', async t => {
	const { runtime, bots, close, profileClose, save } = fixture(t)
	runtime.telemetry.subscribe(snapshot => {
		if (snapshot.connection.state === 'ready') void runtime.stop()
	})
	runtime.start()
	const bot = bots[0]!
	bot.emit('botReady')
	assert.equal(runtime.telemetry.getSnapshot().connection.state, 'connecting')
	await flush()
	await runtime.stop()
	assert.equal(bot.chatMessages.length, 0)
	assert.equal(bot.listenerCount('health'), 0)
	assert.equal(bot.listenerCount('chat'), 0)
	assert.equal(close.mock.callCount(), 1)
	assert.equal(profileClose.mock.callCount(), 1)
	t.mock.timers.tick(300_000)
	await flush()
	assert.equal(save.mock.callCount(), 1)
	assert.equal(bots.length, 1)
})

test('public stop awaits a pending load and its late close while canceling the real harness immediately', async t => {
	const { runtime, bots, load, close, profileLoad } = fixture(t)
	const loading = deferred()
	load.mock.mockImplementation(() => loading.promise)
	runtime.start()
	bots[0]!.emit('botReady')
	const readiness = bots[0]!.hsm.ready
	const stop = runtime.stop()
	assert.equal(runtime.stop('different reason'), stop)
	assert.equal(await readiness, false)
	assert.equal(bots[0]!.quitCalls, 1)
	let settled = false
	void stop.then(() => {
		settled = true
	})
	await flush()
	assert.equal(settled, false)
	assert.equal(close.mock.callCount(), 0)
	loading.resolve()
	assert.equal((await stop).outcome, 'stopped')
	assert.equal(close.mock.callCount(), 1)
	assert.equal(profileLoad.mock.callCount(), 0)
	bots[0]!.emit('botReady')
	bots[0]!.emit('botDisconnected')
	t.mock.timers.tick(300_000)
	await flush()
	assert.equal(bots.length, 1)
})

for (const stage of ['load', 'save'] as const) {
	test(`finite stop deadline reports incomplete ${stage}; late finalization cannot overwrite outcome or reopen stores early`, async t => {
		const { runtime, bots, load, save, close } = fixture(t)
		const pending = deferred()
		if (stage === 'load')
			load.mock.mockImplementationOnce(() => pending.promise)
		else save.mock.mockImplementationOnce(() => pending.promise)
		runtime.start()
		bots[0]!.emit('botReady')
		if (stage === 'save') await flush()
		const stop = runtime.stop()
		t.mock.timers.tick(999)
		await flush()
		assert.equal(runtime.telemetry.getSnapshot().connection.state, 'stopping')
		t.mock.timers.tick(1)
		const result = await stop
		assert.equal(result.outcome, 'timed-out')
		assert.equal(result.persistence, 'incomplete')
		assert.match(result.issues[0]!.message, /may be incomplete/)
		const stoppedSnapshot = runtime.telemetry.getSnapshot()
		assert.equal(runtime.stop(), stop)
		assert.equal(close.mock.callCount(), 0)
		runtime.start()
		assert.equal(
			bots.length,
			1,
			'actual old finalization gates a new explicit start'
		)
		pending.resolve()
		await flush()
		assert.equal(close.mock.callCount(), 1)
		assert.equal(bots.length, 2)
		assert.equal(result.outcome, 'timed-out')
		assert.ok(
			runtime.telemetry.getSnapshot().revision > stoppedSnapshot.revision
		)
		await runtime.stop()
	})
}

test('reconnection waits for late loading and retains canceled session fences', async t => {
	const { runtime, bots, load, close } = fixture(t)
	const pending = deferred()
	load.mock.mockImplementationOnce(() => pending.promise)
	runtime.start()
	bots[0]!.emit('botReady')
	bots[0]!.emit('botDisconnected')
	assert.equal(runtime.telemetry.getSnapshot().connection.state, 'reconnecting')
	t.mock.timers.tick(3000)
	await flush()
	assert.equal(bots.length, 1)
	pending.resolve()
	await flush()
	assert.equal(close.mock.callCount(), 1)
	assert.equal(bots.length, 2)
	bots[0]!.emit('botReady')
	bots[0]!.emit('botDisconnected')
	assert.equal(runtime.telemetry.getSnapshot().connection.state, 'connecting')
	await runtime.stop()
})

test('required save, both store close and connection errors are reported safely while cleanup continues', async t => {
	const { runtime, bots, save, close, profileClose } = fixture(t)
	const fail = () => {
		throw new Error('secret-error-marker')
	}
	save.mock.mockImplementation(async () => fail())
	close.mock.mockImplementation(fail)
	profileClose.mock.mockImplementation(fail)
	runtime.start()
	bots[0]!.emit('botReady')
	await flush()
	t.mock.method(bots[0]!, 'quit', fail)
	const result = await runtime.stop()
	assert.equal(result.outcome, 'failed')
	assert.equal(result.persistence, 'failed')
	assert.equal(result.issues.length, 4)
	assert.equal(bots[0]!.listenerCount('health'), 0)
	assert.equal(bots[0]!.listenerCount('chat'), 0)
	assert.equal(close.mock.callCount(), 1)
	assert.equal(profileClose.mock.callCount(), 1)
	assert.ok(!JSON.stringify(result).includes('secret-error-marker'))
	assert.deepEqual(JSON.parse(JSON.stringify(result)), result)
	assert.ok(Object.isFrozen(result) && Object.isFrozen(result.issues))
})

test('stop joins autosave and finalizes each store once with a truthful saved outcome', async t => {
	const { runtime, bots, save, close } = fixture(t)
	const saving = deferred()
	save.mock.mockImplementation(() => saving.promise)
	runtime.start()
	bots[0]!.emit('botReady')
	await flush()
	void bots[0]!.hsm.save()
	await flush()
	const stop = runtime.stop()
	assert.equal(close.mock.callCount(), 0)
	saving.resolve()
	assert.equal((await stop).persistence, 'saved')
	assert.equal(save.mock.callCount(), 1)
	assert.equal(close.mock.callCount(), 1)
})

test('pending profile load must finalize too, and failed late close is reported after memory closes', async t => {
	const { runtime, bots, profileLoad, close, profileClose } = fixture(t)
	const pending = deferred()
	profileLoad.mock.mockImplementation(() => pending.promise)
	profileClose.mock.mockImplementation(() => {
		throw new Error('private late close')
	})
	runtime.start()
	bots[0]!.emit('botReady')
	await flush()
	const stop = runtime.stop()
	assert.equal(await bots[0]!.hsm.ready, false)
	assert.equal(close.mock.callCount(), 1)
	assert.equal(profileClose.mock.callCount(), 0)
	let settled = false
	void stop.then(() => {
		settled = true
	})
	await flush()
	assert.equal(settled, false)
	pending.resolve()
	const report = await stop
	assert.equal(report.outcome, 'failed')
	assert.equal(report.persistence, 'not-required')
	assert.equal(report.issues[0]?.code, 'profile-close-failed')
	assert.equal(profileClose.mock.callCount(), 1)
})

test('cancellation at the synchronous recovery boundary cannot create a ready actor or restore behavior', async t => {
	const { runtime, bots, close, profileClose } = fixture(t)
	t.mock.method(MemoryManager.prototype, 'normalizeTasksOnBoot', () => {
		void runtime.stop()
		return 0
	})
	runtime.start()
	bots[0]!.emit('botReady')
	await flush()
	assert.equal((await runtime.stop()).outcome, 'stopped')
	assert.equal(await bots[0]!.hsm.ready, false)
	assert.equal(bots[0]!.chatMessages.length, 0)
	assert.equal(bots[0]!.listenerCount('health'), 0)
	assert.equal(close.mock.callCount(), 1)
	assert.equal(profileClose.mock.callCount(), 1)
})

test('deadline reports already observed cleanup errors alongside incomplete pending persistence', async t => {
	const { runtime, bots, load } = fixture(t)
	const pending = deferred()
	load.mock.mockImplementation(() => pending.promise)
	runtime.start()
	bots[0]!.emit('botReady')
	t.mock.method(bots[0]!, 'quit', () => {
		throw new Error('private quit failure')
	})
	const stop = runtime.stop()
	t.mock.timers.tick(1000)
	const result = await stop
	assert.equal(result.outcome, 'timed-out')
	assert.deepEqual(
		result.issues.map(issue => issue.code),
		['connection-quit-failed', 'stop-deadline-exceeded']
	)
	pending.resolve()
	await flush()
	assert.equal(await runtime.stop(), result)
})

test('existing five capped retries produce terminal failure without another timer or leaking raw error', async t => {
	const { runtime, attempts } = fixture(t, 1000, true)
	runtime.start()
	for (const delay of [3000, 6000, 12000, 24000, 48000]) {
		assert.equal(
			runtime.telemetry.getSnapshot().connection.state,
			'reconnecting'
		)
		t.mock.timers.tick(delay)
	}
	assert.equal(attempts(), 6)
	const snapshot = runtime.telemetry.getSnapshot()
	assert.equal(snapshot.connection.state, 'failed')
	assert.equal(
		snapshot.connection.failure?.code,
		'connection-retries-exhausted'
	)
	assert.equal(snapshot.connection.retryAt, null)
	t.mock.timers.tick(300_000)
	assert.equal(attempts(), 6)
	assert.ok(!JSON.stringify(snapshot).includes('private failure marker'))
	await runtime.stop()
})

test('unsupported deadlines are rejected before runtime resources are created', async t => {
	const { services, attempts } = fixture(t)
	for (const stopTimeoutMs of [0, -1, NaN, Infinity, 0.5, 2_147_483_648]) {
		assert.throws(
			() => createBotRuntime(services, { stopTimeoutMs }),
			/stopTimeoutMs/
		)
	}
	assert.equal(attempts(), 0)
})
