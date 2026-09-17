import assert from 'node:assert/strict'
import test from 'node:test'
import { setImmediate as flush } from 'node:timers/promises'

import { ItemFactory, createHarness, registry } from './fixtures/handoffBot.js'

test('a bow without ammunition does not start combat or flight; critical health still preempts', async t => {
	t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] })
	const { bot, actor, observe, step } = createHarness()
	t.after(() => actor.stop())
	bot.inventory.items = () => [new ItemFactory(registry.itemsByName.bow.id, 1)]
	observe()
	await flush()
	assert.ok(actor.getSnapshot().matches({ MAIN_ACTIVITY: 'IDLE' }))
	for (let i = 0; i < 20; i++) {
		t.mock.timers.tick(50)
		await flush()
		step()
	}
	assert.equal(bot.entity.position.x, 0)
	assert.equal(bot.chatMessages.length, 1)
	assert.equal(bot.attacks.length, 0)
	assert.equal(bot.digCalls.length, 0)
	assert.equal(bot.placeCalls.length, 0)
	actor.send({ type: 'UPDATE_HEALTH', health: 8 })
	assert.ok(
		actor
			.getSnapshot()
			.matches({ MAIN_ACTIVITY: { URGENT_NEEDS: 'EMERGENCY_HEALING' } })
	)
})
