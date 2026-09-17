import assert from 'node:assert/strict'
import test from 'node:test'
import { setImmediate as flush } from 'node:timers/promises'

import { Vec3 } from 'vec3'

import { createHarness } from './fixtures/handoffBot.js'

test('recovery failures cannot release critical survival, and recovery requires health and safety', async t => {
	t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] })
	const { actor, enemy, observe } = createHarness()
	t.after(() => actor.stop())
	actor.send({ type: 'UPDATE_HEALTH', health: 8 })
	observe()
	actor.send({ type: 'ERROR', error: 'route failed' })
	assert.ok(
		actor
			.getSnapshot()
			.matches({ MAIN_ACTIVITY: { URGENT_NEEDS: 'EMERGENCY_HEALING' } })
	)
	await flush()
	t.mock.timers.tick(1000)
	await flush()
	actor.send({ type: 'HEALTH_RESTORED' })
	assert.ok(
		actor
			.getSnapshot()
			.matches({ MAIN_ACTIVITY: { URGENT_NEEDS: 'EMERGENCY_HEALING' } })
	)
	actor.send({ type: 'UPDATE_HEALTH', health: 18 })
	actor.send({ type: 'HEALTH_RESTORED' })
	assert.ok(
		actor
			.getSnapshot()
			.matches({ MAIN_ACTIVITY: { URGENT_NEEDS: 'EMERGENCY_HEALING' } })
	)
	enemy.position = new Vec3(40, 64, 0)
	observe()
	t.mock.timers.tick(100)
	await flush()
	assert.ok(actor.getSnapshot().matches({ MAIN_ACTIVITY: 'IDLE' }))
})

test('critical survival waits without food and resumes real escape from a second threat', async t => {
	t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] })
	const { bot, actor, enemy, observe, step } = createHarness()
	t.after(() => actor.stop())
	actor.send({ type: 'UPDATE_FOOD', food: 16 })
	actor.send({ type: 'UPDATE_HEALTH', health: 8 })
	enemy.position = new Vec3(40, 64, 0)
	observe()
	await flush()
	for (let i = 0; i < 5; i++) {
		t.mock.timers.tick(100)
		await flush()
	}
	assert.ok(
		actor
			.getSnapshot()
			.matches({ MAIN_ACTIVITY: { URGENT_NEEDS: 'EMERGENCY_HEALING' } })
	)
	assert.equal(bot.chatMessages.length, 1)
	assert.equal(actor.getSnapshot().context.movementOwner, 'NONE')
	actor.send({ type: 'UPDATE_HEALTH', health: 12 })
	actor.send({ type: 'START_COMBAT', target: enemy })
	actor.send({ type: 'USER_COMMAND', username: 'owner', text: 'new goal' })
	actor.send({ type: 'STOP_CURRENT_GOAL' })
	assert.ok(
		actor
			.getSnapshot()
			.matches({ MAIN_ACTIVITY: { URGENT_NEEDS: 'EMERGENCY_HEALING' } })
	)
	assert.equal(actor.getSnapshot().context.currentGoal, null)
	enemy.position = new Vec3(-2, 64, 0)
	observe()
	actor.send({ type: 'UPDATE_HEALTH', health: 6 })
	for (let i = 0; i < 20; i++) {
		t.mock.timers.tick(50)
		await flush()
		step()
	}
	assert.ok(bot.entity.position.x > 2)
	assert.equal(bot.attacks.length, 0)
	assert.equal(bot.chatMessages.length, 1)
})
