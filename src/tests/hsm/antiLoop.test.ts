import assert from 'node:assert/strict'
import test from 'node:test'
import { setImmediate as flush } from 'node:timers/promises'

import Logger from '../../config/logger.js'
import BotStateMachine from '../../core/hsm.js'
import { MemoryManager } from '../../core/memory/index.js'
import { ProfileMemoryStore } from '../../core/profile/index.js'
import { AntiLoopGuard } from '../../hsm/utils/antiLoop.js'
import { createHarness } from './fixtures/handoffBot.js'

test('HSM observer resets the guard after its cooldown', async t => {
	t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] })
	t.mock.method(Logger, 'info', () => {})
	t.mock.method(Logger, 'error', () => {})
	const { bot, actor } = createHarness()
	actor.stop()
	const memory = new MemoryManager({ botName: bot.username })
	const profile = new ProfileMemoryStore({ botName: bot.username })
	bot.asBot().memory = memory
	bot.asBot().profileMemory = profile
	t.mock.method(memory, 'load', async () => {})
	t.mock.method(memory, 'save', async () => {})
	t.mock.method(memory, 'close', () => {})
	t.mock.method(profile, 'load', async () => {})
	t.mock.method(profile, 'close', () => {})
	const hsm = new BotStateMachine(bot.asBot())
	t.after(() => hsm.stop())
	assert.equal(await hsm.ready, true)
	hsm.send({ type: 'UPDATE_ENTITIES', entities: [], enemies: [], players: [] })
	const warnings = () =>
		bot.chatMessages.filter(message => message.includes('критическая ошибка'))
	const cycleRecovery = () => {
		hsm.send({ type: 'START_URGENT_NEEDS', need: 'health' })
		hsm.send({ type: 'HEALTH_RESTORED' })
	}
	for (let i = 0; i < 12; i++) cycleRecovery()
	assert.equal(warnings().length, 1)
	t.mock.timers.tick(60_000)
	await flush()
	hsm.send({ type: 'UPDATE_ENTITIES', entities: [], enemies: [], players: [] })
	cycleRecovery()
	assert.equal(
		warnings().length,
		1,
		'a fresh transition after cooldown is allowed'
	)
	for (let i = 0; i < 12; i++) cycleRecovery()
	assert.equal(
		warnings().length,
		2,
		'the guard still detects a subsequent flood'
	)
})

test('AntiLoopGuard ignores repeated updates with the same state signature', () => {
	const guard = new AntiLoopGuard({
		maxTransitionsPerSecond: 2,
		emergencyStopAfter: 100,
		windowMs: 1000
	})

	assert.equal(guard.recordUpdate('TASKS.THINKING'), true)
	assert.equal(guard.recordUpdate('TASKS.THINKING'), true)
	assert.equal(guard.recordUpdate('TASKS.THINKING'), true)

	const stats = guard.getStats()
	assert.equal(stats.loopDetected, false)
	assert.equal(stats.totalUpdates, 1)
	assert.equal(stats.updatesInLastSecond, 1)
})

test('AntiLoopGuard trips on update flood and recovers after reset', () => {
	const originalLoggerError = Logger.error
	Logger.error = () => {}
	try {
		const guard = new AntiLoopGuard({
			maxTransitionsPerSecond: 2,
			emergencyStopAfter: 100,
			windowMs: 60_000
		})

		assert.equal(guard.recordUpdate('STATE_A'), true)
		assert.equal(guard.recordUpdate('STATE_B'), true)
		assert.equal(guard.recordUpdate('STATE_C'), false)

		assert.equal(guard.getStats().loopDetected, true)
		assert.equal(guard.recordUpdate('STATE_D'), false)

		guard.reset()

		assert.equal(guard.getStats().loopDetected, false)
		assert.equal(guard.recordUpdate('STATE_D'), true)
	} finally {
		Logger.error = originalLoggerError
	}
})
