import assert from 'node:assert/strict'
import test from 'node:test'
import { setImmediate as flush } from 'node:timers/promises'

import type { Bot } from '@/types'

import Config from '@/config/config'
import Logger from '@/config/logger'

import MinecraftBot from '@/core/bot'
import { MemoryManager } from '@/core/memory'
import { ProfileMemoryStore } from '@/core/profile'

import { createHarness } from '../hsm/fixtures/handoffBot'

const deferred = () => {
	let resolve!: () => void
	const promise = new Promise<void>(done => {
		resolve = done
	})
	return { promise, resolve }
}

const createConnectionBot = () => {
	const { bot, actor } = createHarness()
	actor.stop()
	return Object.assign(bot, {
		quitCalls: 0,
		quit(reason?: string) {
			this.quitCalls++
			bot.emit('end', reason)
		}
	})
}

const fixture = (t: test.TestContext) => {
	t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] })
	t.mock.method(Config, 'assertAIConfigured', () => {})
	t.mock.method(Logger, 'info', () => {})
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
	const connections: ReturnType<typeof createConnectionBot>[] = []
	const runtime = new MinecraftBot({
		createBot: () => {
			const bot = createConnectionBot()
			connections.push(bot)
			return bot.asBot()
		},
		initConnection: (bot: Bot) => {
			const spawn = () => {
				bot.emit('botReady')
			}
			const end = (reason: string) => {
				bot.emit('botDisconnected', reason)
			}
			bot.on('spawn', spawn)
			bot.on('end', end)
			return () => {
				bot.off('spawn', spawn)
				bot.off('end', end)
			}
		}
	})
	t.after(() => runtime.stop())
	return { runtime, connections, load, save, close, profileLoad, profileClose }
}

test('disconnect disposes the old HSM, commands and autosave before a fresh session starts', async t => {
	const { runtime, connections, load, save, close, profileClose } = fixture(t)
	runtime.start()
	const first = connections[0]!
	first.emit('spawn')
	await flush()
	const oldMemory = first.asBot().memory
	first.emit('spawn')
	assert.equal(
		load.mock.callCount(),
		1,
		'duplicate ready cannot create another HSM'
	)
	first.emit('end')
	assert.equal(first.listenerCount('chat'), 0)
	assert.equal(first.listenerCount('health'), 0)
	await flush()
	assert.equal(close.mock.callCount(), 1)
	assert.equal(profileClose.mock.callCount(), 1)
	t.mock.timers.tick(3000)
	await flush()
	assert.equal(connections.length, 2)
	const second = connections[1]!
	second.emit('spawn')
	await flush()
	const currentHsm = second.hsm
	first.emit('botReady')
	first.emit('chat', 'player', ':obsolete goal')
	first.emit('botDisconnected')
	assert.equal(second.hsm, currentHsm)
	assert.equal(second.hsm.getContext().currentGoal, null)
	t.mock.timers.tick(300_000)
	await flush()
	assert.equal(
		save.mock.calls.filter(call => call.this === oldMemory).length,
		1
	)
	assert.equal(
		save.mock.calls.filter(call => call.this === second.asBot().memory).length,
		1
	)
	await runtime.stop()
	assert.equal(close.mock.callCount(), 2)
	assert.equal(profileClose.mock.callCount(), 2)
})

test('disconnect carries an active goal as paused state into the next session', async t => {
	const previousProvider = Config.ai.provider
	Config.ai.provider = 'disabled'
	t.after(() => {
		Config.ai.provider = previousProvider
	})

	const { runtime, connections } = fixture(t)
	runtime.start()
	const first = connections[0]!
	first.emit('spawn')
	await flush()
	first.hsm.send({ type: 'USER_COMMAND', username: 'Steve', text: 'Travel' })
	await flush()
	await flush()
	assert.equal(first.hsm.getContext().currentGoal, null)
	assert.equal(first.hsm.getContext().pausedGoal, 'Travel')
	first.emit('end')
	await flush()

	t.mock.timers.tick(3000)
	await flush()
	const second = connections[1]!
	second.emit('spawn')
	await flush()

	assert.equal(second.hsm.getContext().currentGoal, null)
	assert.equal(second.hsm.getContext().pausedGoal, 'Travel')
})

test('explicit stop before spawn closes the connection and cannot reconnect', async t => {
	const { runtime, connections, load } = fixture(t)
	runtime.start()
	const bot = connections[0]!
	await runtime.stop()
	bot.emit('spawn')
	bot.emit('botDisconnected')
	t.mock.timers.tick(300_000)
	await flush()
	assert.equal(bot.quitCalls, 1)
	assert.equal(load.mock.callCount(), 0)
	assert.equal(connections.length, 1)
})

test('explicit stop cancels an already scheduled reconnect', async t => {
	const { runtime, connections } = fixture(t)
	runtime.start()
	connections[0]!.emit('end')
	await runtime.stop()
	t.mock.timers.tick(300_000)
	await flush()
	assert.equal(connections.length, 1)
	runtime.start()
	assert.equal(connections.length, 2, 'a later explicit start remains possible')
})

test('stop while memory loads returns immediately and the late load only closes resources', async t => {
	const { runtime, connections, load, close, profileLoad } = fixture(t)
	const loading = deferred()
	load.mock.mockImplementation(() => loading.promise)
	runtime.start()
	const bot = connections[0]!
	bot.emit('spawn')
	const readiness = bot.hsm.ready
	await runtime.stop()
	assert.equal(await readiness, false)
	assert.equal(bot.quitCalls, 1)
	assert.equal(
		close.mock.callCount(),
		0,
		'a pending load may still open its handle'
	)
	loading.resolve()
	await flush()
	t.mock.timers.tick(10_000)
	await flush()
	assert.equal(close.mock.callCount(), 1)
	assert.equal(profileLoad.mock.callCount(), 0)
	assert.equal(bot.listenerCount('health'), 0)
	assert.equal(bot.listenerCount('chat'), 0)
	assert.equal(bot.chatMessages.length, 0)
	assert.equal(connections.length, 1)
})

test('save and close failures cannot keep behavior, the connection or another store alive', async t => {
	const { runtime, connections, save, close, profileClose } = fixture(t)
	save.mock.mockImplementation(async () => {
		throw new Error('save unavailable')
	})
	close.mock.mockImplementation(() => {
		throw new Error('close unavailable')
	})
	runtime.start()
	const bot = connections[0]!
	bot.emit('spawn')
	await flush()
	const stopping = runtime.stop()
	assert.equal(bot.quitCalls, 1, 'connection closes before persistence settles')
	assert.equal(bot.listenerCount('health'), 0)
	await stopping
	await runtime.stop()
	assert.equal(close.mock.callCount(), 1)
	assert.equal(profileClose.mock.callCount(), 1)
	t.mock.timers.tick(10_000)
	await flush()
	assert.equal(connections.length, 1)
})

test('failed loading is handled, closed and followed by one fresh connection', async t => {
	const { runtime, connections, load, close, profileLoad } = fixture(t)
	load.mock.mockImplementation(async () => {
		throw new Error('load unavailable')
	})
	runtime.start()
	const bot = connections[0]!
	bot.emit('spawn')
	await flush()
	assert.equal(await bot.hsm.ready, false)
	assert.equal(bot.quitCalls, 1)
	assert.equal(close.mock.callCount(), 1)
	assert.equal(profileLoad.mock.callCount(), 0)
	assert.equal(bot.listenerCount('chat'), 0)
	t.mock.timers.tick(3000)
	await flush()
	assert.equal(connections.length, 2)
})

test('reconnect waits for the previous save and repeated stop joins the same cleanup', async t => {
	const { runtime, connections, save, close } = fixture(t)
	const saving = deferred()
	save.mock.mockImplementation(() => saving.promise)
	runtime.start()
	connections[0]!.emit('spawn')
	await flush()
	connections[0]!.emit('end')
	t.mock.timers.tick(3000)
	await flush()
	assert.equal(
		connections.length,
		1,
		'old persistence must settle before a new session opens the stores'
	)
	let stopped = false
	const stop = runtime.stop().then(() => {
		stopped = true
	})
	await flush()
	assert.equal(stopped, false)
	saving.resolve()
	await stop
	await flush()
	assert.equal(close.mock.callCount(), 1)
	assert.equal(
		connections.length,
		1,
		'stop also cancels a reconnect waiting for persistence'
	)
})
