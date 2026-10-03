import assert from 'node:assert/strict'
import test from 'node:test'

import type { RuntimeLogRecord } from '../../config/runtimeLogger.js'
import { createConnectionInitializer } from '../../modules/connection/runtimeConnection.js'
import { createTestLogger } from '../ai/fixtures/runtimeServices.js'
import { HandoffBot } from '../hsm/fixtures/handoffBot.js'

test('connection initializer configures native plugins and keeps events/logger owned by its instance', () => {
	const recordsA: RuntimeLogRecord[] = [],
		recordsB: RuntimeLogRecord[] = []
	const botA = new HandoffBot(),
		botB = new HandoffBot()
	const disposeA = createConnectionInitializer(createTestLogger(recordsA))(
		botA.asBot()
	)
	const disposeB = createConnectionInitializer(createTestLogger(recordsB))(
		botB.asBot()
	)
	let readyA = 0,
		readyB = 0
	botA.on('botReady', () => readyA++)
	botB.on('botReady', () => readyB++)
	try {
		botA.emit('spawn')
		botB.emit('spawn')
		assert.equal(readyA, 1)
		assert.equal(readyB, 1)
		assert.ok(botA.pathfinder && botA.pvp && botA.movements)
		assert.ok(botB.pathfinder && botB.pvp && botB.movements)
		assert.equal(botA.movements, botA.pvp.movements)
		assert.equal(botA.asBot().autoEat.opts.strictErrors, true)
		assert.equal(botA.asBot().autoEat.opts.eatingTimeout, 10000)
		let disconnected = ''
		botA.on('botDisconnected', reason => {
			disconnected = reason
		})
		botA.emit('end', 'fixture disconnect')
		assert.equal(disconnected, 'fixture disconnect')
		assert.ok(
			recordsA.some(record => record.message.includes('fixture disconnect'))
		)
		assert.ok(
			!recordsB.some(record => record.message.includes('fixture disconnect'))
		)
		const counts = ['end', 'error'].map(event => botA.listenerCount(event))
		disposeA()
		assert.deepEqual(
			['end', 'error'].map(event => botA.listenerCount(event)),
			counts.map(count => count - 1)
		)
		disposeA()
		assert.deepEqual(
			['end', 'error'].map(event => botA.listenerCount(event)),
			counts.map(count => count - 1)
		)
	} finally {
		disposeA()
		disposeB()
		botA.removeAllListeners()
		botB.removeAllListeners()
	}
})

test('connection plugin-load failure removes its listeners before propagating the error', t => {
	const bot = new HandoffBot()
	const failure = new Error('fixture plugin load failed')
	t.mock.method(bot, 'loadPlugin', () => {
		throw failure
	})
	const initialize = createConnectionInitializer(createTestLogger())
	assert.throws(
		() => initialize(bot.asBot()),
		error => error === failure
	)
	assert.equal(bot.listenerCount('spawn'), 0)
	assert.equal(bot.listenerCount('end'), 0)
	assert.equal(bot.listenerCount('error'), 0)
})
