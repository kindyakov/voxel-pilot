import assert from 'node:assert/strict'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { setImmediate as flush } from 'node:timers/promises'

import { isMachineSnapshot } from 'xstate'

import {
	createRuntimeConfigFromEnvironment,
	createRuntimeLogger,
	createRuntimeServices
} from '../../config/services.js'
import BotStateMachine from '../../core/harness.js'
import { MemoryManager } from '../../core/memory/index.js'
import { ProfileMemoryStore } from '../../core/profile/index.js'
import { createBotRuntime } from '../../core/runtime.js'
import type {
	NativeInspectionControls,
	NativeInspectionOptions,
	NativeInspectionRecord
} from '../../hsm/inspection/index.js'
import { createEntityFixture } from '../hsm/fixtures/handoffBot.js'
import { testHarnessDependencies } from '../hsm/fixtures/services.js'
import { createRuntimeConnectionBot } from './fixtures/runtimeBot.js'

function deferred() {
	let resolve!: () => void
	let reject!: (error: Error) => void
	const promise = new Promise<void>((done, fail) => {
		resolve = done
		reject = fail
	})
	return { promise, resolve, reject }
}

function fixture(t: test.TestContext) {
	t.mock.timers.enable({ apis: ['Date', 'setTimeout', 'setInterval'] })
	const bot = createRuntimeConnectionBot('native-inspection-fixture')
	bot.asBot().memory = new MemoryManager({
		botName: bot.username,
		dataDir: tmpdir()
	})
	bot.asBot().profileMemory = new ProfileMemoryStore({
		botName: bot.username,
		dataDir: tmpdir()
	})
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
	return { bot, load, save, close, profileLoad, profileClose }
}

function observerFixture() {
	const records: NativeInspectionRecord[] = []
	const sessions: { controls: NativeInspectionControls; closed: number }[] = []
	const options: NativeInspectionOptions = {
		createObserver(controls) {
			const session = { controls, closed: 0 }
			sessions.push(session)
			return {
				next(record) {
					records.push(record)
				},
				dispose() {
					session.closed++
				}
			}
		}
	}
	return { options, records, sessions }
}

test('absence of native opt-in allocates no inspection task and preserves normal HSM startup', async t => {
	const { bot } = fixture(t)
	const scheduled = t.mock.method(globalThis, 'setImmediate')
	const hsm = new BotStateMachine(
		bot.asBot(),
		testHarnessDependencies({ aiPilotEnabled: false })
	)
	t.after(() => hsm.finalize())
	assert.equal(await hsm.ready, true)
	assert.equal(scheduled.mock.callCount(), 0)
	bot.health = 9
	bot.emit('health')
	assert.equal(hsm.getContext().health, 9)
	assert.equal(scheduled.mock.callCount(), 0)
	assert.deepEqual((await hsm.finalize()).issues, [])
})

test('startup failure after observer creation disposes its queue before actor execution', async t => {
	const { bot } = fixture(t)
	const { options, records, sessions } = observerFixture()
	const listen = bot.on.bind(bot)
	t.mock.method(bot, 'on', (...args: Parameters<typeof bot.on>) => {
		if (args[0] === 'health')
			throw new Error('fixture event boundary unavailable')
		return listen(...args)
	})
	const hsm = new BotStateMachine(bot.asBot(), testHarnessDependencies(), {
		inspection: options
	})
	assert.equal(await hsm.ready, false)
	assert.equal(sessions.length, 1)
	assert.equal(sessions[0]!.closed, 1)
	assert.equal(sessions[0]!.controls.getStats().queued, 0)
	await flush()
	assert.deepEqual(records, [])
	assert.equal(
		(await hsm.finalize()).issues[0]?.code,
		'harness-initialization-failed'
	)
})

test('a hanging/rejected observer disposer never holds actual storage finalization', async t => {
	const { bot } = fixture(t)
	const pending = deferred()
	let controls!: NativeInspectionControls
	let closes = 0
	const hsm = new BotStateMachine(bot.asBot(), testHarnessDependencies(), {
		inspection: {
			createObserver(value) {
				controls = value
				return {
					next() {},
					dispose() {
						closes++
						return pending.promise
					}
				}
			}
		}
	})
	assert.equal(await hsm.ready, true)
	assert.deepEqual((await hsm.finalize()).issues, [])
	assert.equal(closes, 1)
	assert.equal(controls.getStats().active, false)
	pending.reject(new Error('private late cleanup marker'))
	await flush()
	assert.equal(controls.getStats().failed, true)
	assert.deepEqual((await hsm.finalize()).issues, [])
})

test('real HSM native inspection includes constructor actors, early children, actions and microsteps', async t => {
	const { bot } = fixture(t)
	const { options, records, sessions } = observerFixture()
	const hsm = new BotStateMachine(
		bot.asBot(),
		testHarnessDependencies({ aiPilotEnabled: false }),
		{ inspection: options }
	)
	t.after(() => hsm.finalize())
	assert.equal(
		sessions.length,
		0,
		'observer is not constructed until stores are ready'
	)
	assert.equal(await hsm.ready, true)
	await flush()
	const first = records[0]!
	assert.equal(first.event.type, '@xstate.actor')
	assert.equal(first.event.actorRef.sessionId, first.event.rootId)
	const root = first.event.actorRef
	const initialization = records.find(
		record =>
			record.event.type === '@xstate.event' &&
			record.event.actorRef === root &&
			record.event.event.type === 'xstate.init'
	)!
	assert.ok(initialization)
	const children = records.filter(
		record =>
			record.event.type === '@xstate.actor' && record.event.actorRef !== root
	)
	assert.ok(children.length >= 3, 'actual initial invoked actors are visible')
	assert.ok(
		children.some(record => record.sequence < initialization.sequence),
		'initial child creation precedes root start'
	)
	const rootSnapshot = root.getSnapshot()
	assert.ok(isMachineSnapshot(rootSnapshot))
	assert.equal(rootSnapshot.machine.id, 'MINECRAFT_BOT')
	assert.ok(
		Object.keys(rootSnapshot.children).length >= 3,
		'native model/tree facts remain available'
	)
	bot.health = 8
	bot.emit('health')
	await flush()
	assert.equal(hsm.getContext().health, 8)
	const types = new Set<string>(records.map(record => record.event.type))
	for (const type of [
		'@xstate.actor',
		'@xstate.event',
		'@xstate.action',
		'@xstate.microstep',
		'@xstate.snapshot'
	])
		assert.ok(types.has(type))
	const step = records.find(
		record => record.event.type === '@xstate.microstep'
	)!
	if (step.event.type !== '@xstate.microstep')
		assert.fail('native microstep missing')
	assert.ok(isMachineSnapshot(step.event.snapshot))
	assert.ok(
		Array.isArray(step.event._transitions),
		'uses pinned5.30 native facts'
	)
	assert.ok(
		records.some(
			record =>
				record.event.type === '@xstate.event' &&
				record.event.event.type === 'UPDATE_HEALTH'
		)
	)
	assert.equal(sessions[0]!.controls.getStats().dropped, 0)
	await hsm.finalize()
	assert.equal(sessions[0]!.closed, 1)
	assert.equal(sessions[0]!.controls.getStats().active, false)
})

test('observer-only detach leaves actual native physics and health/commands running', async t => {
	const { bot } = fixture(t)
	const { options, records, sessions } = observerFixture()
	const hsm = new BotStateMachine(
		bot.asBot(),
		testHarnessDependencies({ aiPilotEnabled: false }),
		{ inspection: options }
	)
	t.after(() => hsm.finalize())
	assert.equal(await hsm.ready, true)
	await flush()
	sessions[0]!.controls.detach()
	sessions[0]!.controls.detach()
	const observed = records.length
	assert.equal(sessions[0]!.closed, 1)
	bot.health = 8
	bot.emit('health')
	assert.equal(hsm.getContext().health, 8)
	hsm.send({ type: 'UPDATE_FOOD', food: 17 })
	assert.equal(hsm.getContext().food, 17)
	assert.ok(
		hsm.isInState({ MAIN_ACTIVITY: { URGENT_NEEDS: 'EMERGENCY_HEALING' } })
	)
	const enemy = createEntityFixture({
		id: 1,
		type: 'hostile',
		name: 'zombie',
		height: 1.8,
		position: bot.entity.position.offset(1.5, 0, 0),
		isValid: true,
		metadata: []
	})
	bot.entities = { 1: enemy }
	const before = bot.entity.position.distanceTo(enemy.position)
	for (let i = 0; i < 24; i++) {
		t.mock.timers.tick(50)
		await flush()
		bot.simulatePhysicsTick()
		bot.emit('move')
	}
	assert.ok(
		bot.entity.position.distanceTo(enemy.position) > before + 1,
		'real flee displacement continues after observer closes'
	)
	assert.equal(records.length, observed)
	assert.equal(bot.quitCalls, 0)
})

for (const failure of ['factory', 'callback', 'rejection'] as const)
	test(`real HSM survives ${failure} failure and observer errors do not enter storage finalization`, async t => {
		const { bot } = fixture(t)
		let closes = 0
		const inspection: NativeInspectionOptions = {
			createObserver() {
				if (failure === 'factory')
					throw new Error('private native factory marker')
				return {
					next() {
						if (failure === 'rejection')
							return Promise.reject(new Error('private native callback marker'))
						throw new Error('private native callback marker')
					},
					dispose() {
						closes++
						throw new Error('private native disposer marker')
					}
				}
			}
		}
		const hsm = new BotStateMachine(
			bot.asBot(),
			testHarnessDependencies({ aiPilotEnabled: false }),
			{ inspection }
		)
		t.after(() => hsm.finalize())
		assert.equal(await hsm.ready, true)
		await flush()
		bot.health = 9
		bot.emit('health')
		hsm.send({ type: 'UPDATE_FOOD', food: 16 })
		assert.equal(hsm.getContext().health, 9)
		assert.equal(hsm.getContext().food, 16)
		const result = await hsm.finalize()
		assert.equal(result.persistence, 'saved')
		assert.deepEqual(result.issues, [])
		assert.equal(closes, failure === 'factory' ? 0 : 1)
	})

test('stop before pending stores finish creates no observer, while ready stop disposes before deferred save', async t => {
	const { bot, load, save, close } = fixture(t)
	const loading = deferred()
	load.mock.mockImplementation(() => loading.promise)
	const { options, sessions } = observerFixture()
	const canceled = new BotStateMachine(bot.asBot(), testHarnessDependencies(), {
		inspection: options
	})
	await canceled.stop()
	assert.equal(await canceled.ready, false)
	assert.equal(sessions.length, 0)
	loading.resolve()
	await canceled.finalize()
	assert.equal(sessions.length, 0)
	assert.equal(close.mock.callCount(), 1)
	load.mock.mockImplementation(async () => {})
	const hsm = new BotStateMachine(bot.asBot(), testHarnessDependencies(), {
		inspection: options
	})
	assert.equal(await hsm.ready, true)
	const saving = deferred()
	save.mock.mockImplementation(() => saving.promise)
	let completed = false
	const stopped = hsm.finalize().then(() => {
		completed = true
	})
	assert.equal(
		sessions[0]!.closed,
		1,
		'observer closes synchronously before save starts'
	)
	assert.equal(sessions[0]!.controls.getStats().queued, 0)
	await flush()
	assert.equal(completed, false)
	saving.resolve()
	await stopped
	assert.equal(sessions[0]!.closed, 1)
})

test('observer factory reentrant owner cancellation cannot construct an actor or leave observation alive', async t => {
	const { bot } = fixture(t)
	let hsm!: BotStateMachine
	let closes = 0
	hsm = new BotStateMachine(bot.asBot(), testHarnessDependencies(), {
		inspection: {
			createObserver() {
				void hsm.stop()
				return {
					next() {
						assert.fail('canceled native event')
					},
					dispose() {
						closes++
					}
				}
			}
		}
	})
	assert.equal(await hsm.ready, false)
	assert.deepEqual((await hsm.finalize()).issues, [])
	assert.equal(closes, 1)
	assert.equal(hsm.getCurrentState(), 'IDLE')
	assert.equal(bot.listenerCount('health'), 0)
})

test('portable composition creates fresh inspection per reconnect; old async work and detach cannot affect it', async t => {
	const { load } = fixture(t)
	const handle = createRuntimeLogger({
		aiModel: 'fixture',
		console: false,
		files: false
	})
	t.after(() => handle.close())
	const config = createRuntimeConfigFromEnvironment(
		{
			MINECRAFT_HOST: 'localhost',
			MINECRAFT_PORT: '25565',
			MINECRAFT_USERNAME: 'inspection',
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
	const bots: ReturnType<typeof createRuntimeConnectionBot>[] = []
	const sessions: NativeInspectionControls[] = []
	const late = deferred()
	let closes = 0,
		secondCalls = 0
	const runtime = createBotRuntime(
		createRuntimeServices({ config, logger: handle.logger }),
		{
			inspection: {
				createObserver(controls) {
					sessions.push(controls)
					const first = sessions.length === 1
					return {
						next() {
							if (first) return late.promise
							secondCalls++
							return undefined
						},
						dispose() {
							closes++
						}
					}
				}
			},
			connection: {
				createBot() {
					const bot = createRuntimeConnectionBot()
					bots.push(bot)
					return bot.asBot()
				},
				initConnection: () => () => {}
			}
		}
	)
	t.after(() => runtime.stop())
	runtime.start()
	assert.equal(sessions.length, 0)
	bots[0]!.emit('botReady')
	await flush()
	await flush()
	assert.equal(sessions.length, 1)
	assert.equal(sessions[0]!.getStats().inFlight, true)
	bots[0]!.emit('botDisconnected')
	assert.equal(closes, 1)
	assert.equal(sessions[0]!.getStats().queued, 0)
	await flush()
	t.mock.timers.tick(3000)
	await flush()
	assert.equal(bots.length, 2)
	bots[1]!.emit('botReady')
	await flush()
	await flush()
	assert.equal(sessions.length, 2)
	late.reject(new Error('private old session marker'))
	await flush()
	sessions[0]!.detach()
	assert.equal(sessions[1]!.getStats().active, true)
	assert.ok(secondCalls > 0)
	assert.equal(load.mock.callCount(), 2)
	assert.equal(runtime.telemetry.getSnapshot().connection.state, 'ready')
	assert.deepEqual(Object.keys(runtime).sort(), ['start', 'stop', 'telemetry'])
	const result = await runtime.stop()
	assert.equal(result.outcome, 'stopped')
	assert.deepEqual(result.issues, [])
	assert.equal(closes, 2)
})
