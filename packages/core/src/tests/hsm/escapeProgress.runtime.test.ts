import assert from 'node:assert/strict'
import test from 'node:test'
import { setImmediate as flush } from 'node:timers/promises'

import { Vec3 } from 'vec3'

import { createHarness } from './fixtures/handoffBot.js'

for (const distance of [2, 6]) {
	test(`an active escape route is replaced when a threat moves ${distance} blocks behind the bot`, async t => {
		t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] })
		const { bot, actor, enemy, observe, step } = createHarness()
		t.after(() => actor.stop())
		enemy.position = new Vec3(18, 64, 0)
		actor.send({ type: 'UPDATE_HEALTH', health: 8 })
		observe()
		await flush()
		for (let i = 0; i < 20; i++) {
			t.mock.timers.tick(50)
			await flush()
			step()
		}
		const turnAt = bot.entity.position.x
		assert.ok(turnAt < -2)
		enemy.position = bot.entity.position.offset(-distance, 0, 0)
		observe()
		for (let i = 0; i < 30; i++) {
			t.mock.timers.tick(50)
			await flush()
			step()
		}
		assert.ok(
			bot.entity.position.x > turnAt + 2,
			'must stop following the old route toward the new danger'
		)
	})
}

test('a trapped survivor reports no exit once and moves again when a corridor opens', async t => {
	t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] })
	const { bot, actor, enemy, observe, step } = createHarness()
	t.after(() => actor.stop())
	let open = false
	bot.solidAt = p =>
		p.y < 64 ||
		(p.y < 69 &&
			(Math.abs(Math.floor(p.x)) >= 2 || Math.abs(Math.floor(p.z)) >= 2) &&
			!(open && p.x < -1 && Math.abs(p.z) < 2))
	enemy.position = new Vec3(1, 64, 0)
	actor.send({ type: 'UPDATE_HEALTH', health: 8 })
	observe()
	await flush()
	for (let i = 0; i < 160; i++) {
		t.mock.timers.tick(50)
		await flush()
		step()
	}
	assert.equal(
		bot.chatMessages.filter(message => /выход|застрял/i.test(message)).length,
		1
	)
	assert.equal(bot.attacks.length, 0)
	assert.equal(bot.digCalls.length, 0)
	assert.equal(bot.placeCalls.length, 0)
	open = true
	bot.emit('blockUpdate', null, bot.blockAt(new Vec3(-2, 64, 0)))
	for (let i = 0; i < 100; i++) {
		t.mock.timers.tick(50)
		await flush()
		step()
	}
	assert.ok(bot.entity.position.x < -4)
	assert.ok(
		actor
			.getSnapshot()
			.matches({ MAIN_ACTIVITY: { URGENT_NEEDS: 'EMERGENCY_HEALING' } })
	)
})
