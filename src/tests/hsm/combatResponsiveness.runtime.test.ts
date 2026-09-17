import assert from 'node:assert/strict'
import test from 'node:test'
import { setImmediate as flush } from 'node:timers/promises'

import { createHarness } from './fixtures/handoffBot.js'

test('melee starts after equip without waiting for the periodic tick', async t => {
	t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] })
	const { bot, actor, enemy, observe } = createHarness(false, '1.20.6')
	t.after(() => actor.stop())
	observe()
	await flush()
	assert.equal(bot.pvp.target?.id, enemy.id)
	bot.emit('physicTick')
	await flush()
	assert.deepEqual(bot.attacks, [enemy.id])
})

test('noncritical damage keeps the same melee invocation and controller', async t => {
	t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] })
	const { bot, actor, enemy, observe } = createHarness()
	t.after(() => actor.stop())
	observe()
	await flush()
	t.mock.timers.tick(500)
	await flush()
	const children = Object.values(actor.getSnapshot().children)
	for (const health of [17, 14, 11]) {
		bot.emit('entityHurt', bot.entity, enemy)
		actor.send({ type: 'UPDATE_HEALTH', health })
		await flush()
		assert.deepEqual(Object.values(actor.getSnapshot().children), children)
		assert.equal(bot.pvp.target?.id, enemy.id)
	}
	assert.equal(bot.equippedItems.length, 1)
})
