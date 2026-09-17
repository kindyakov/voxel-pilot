import assert from 'node:assert/strict'
import test from 'node:test'
import { setImmediate as flush } from 'node:timers/promises'

import { Vec3 } from 'vec3'

import {
	BlockFactory,
	ItemFactory,
	createHarness,
	registry
} from './fixtures/handoffBot.js'

test('approach without actual progress stops without fleeing and unchanged observations do not reset its limit', async t => {
	t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] })
	const { bot, actor, enemy, observe } = createHarness()
	const pvpTargetId = () => bot.pvp.target?.id
	t.after(() => actor.stop())
	bot.inventory.items = () => [
		new ItemFactory(registry.itemsByName.iron_sword.id, 1)
	]
	enemy.position = new Vec3(7, 64, 0)
	observe()
	await flush()
	// The server never confirms displacement despite active PVP/pathfinder controls.
	for (let i = 0; i < 45; i++) {
		observe()
		t.mock.timers.tick(100)
		await flush()
	}
	assert.ok(
		actor.getSnapshot().matches({ MAIN_ACTIVITY: { COMBAT: 'WAITING' } })
	)
	for (let i = 0; i < 20; i++) {
		observe()
		t.mock.timers.tick(100)
		await flush()
	}
	assert.equal(bot.pvp.target, undefined)
	assert.equal(bot.controlState.forward, false)
	assert.equal(bot.pathfinder.goal, null)
	actor.send({ type: 'START_COMBAT', target: enemy })
	assert.ok(
		actor.getSnapshot().matches({ MAIN_ACTIVITY: { COMBAT: 'WAITING' } })
	)
	// A changed passage is an explicit opportunity, unlike another entity update.
	const closedGate = BlockFactory.fromProperties(
		registry.blocksByName.oak_fence_gate.id,
		{ open: false },
		0
	)
	const openGate = BlockFactory.fromProperties(
		registry.blocksByName.oak_fence_gate.id,
		{ open: true },
		0
	)
	closedGate.position = new Vec3(2, 64, 0)
	openGate.position = closedGate.position.clone()
	assert.equal(openGate.type, closedGate.type)
	assert.notDeepEqual(openGate.shapes, closedGate.shapes)
	bot.emit('blockUpdate', closedGate, openGate)
	observe()
	await flush()
	t.mock.timers.tick(500)
	await flush()
	assert.ok(
		actor
			.getSnapshot()
			.matches({ MAIN_ACTIVITY: { COMBAT: 'MELEE_ATTACKING' } })
	)
	// The same encounter has only two changed-condition retries, not a new budget per tick.
	for (let retry = 1; retry <= 2; retry++) {
		for (let i = 0; i < 45; i++) {
			observe()
			t.mock.timers.tick(100)
			await flush()
		}
		assert.ok(
			actor.getSnapshot().matches({ MAIN_ACTIVITY: { COMBAT: 'WAITING' } })
		)
		bot.emit('blockUpdate', null, bot.blockAt(new Vec3(2, 64, 0)))
		observe()
		await flush()
		t.mock.timers.tick(500)
		await flush()
		assert.ok(
			actor.getSnapshot().matches({
				MAIN_ACTIVITY: {
					COMBAT: retry === 1 ? 'MELEE_ATTACKING' : 'WAITING'
				}
			})
		)
	}
	assert.equal(
		actor.getSnapshot().context.approachAttempts[enemy.id]?.resumes,
		2
	)
	actor.send({
		type: 'UPDATE_ENTITIES',
		entities: [],
		enemies: [],
		players: []
	})
	t.mock.timers.tick(500)
	await flush()
	observe()
	assert.equal(
		actor.getSnapshot().context.approachAttempts[enemy.id]?.resumes,
		2,
		'brief occlusion must preserve the budget'
	)
	// Pursuit stays exhausted, but a mob entering reach must not get free hits.
	enemy.position = bot.entity.position.offset(2, 0, 0)
	observe()
	await flush()
	t.mock.timers.tick(500)
	await flush()
	assert.equal(pvpTargetId(), enemy.id)
	assert.equal(
		actor.getSnapshot().context.approachAttempts[enemy.id]?.resumes,
		2
	)
	enemy.position = bot.entity.position.offset(7, 0, 0)
	observe()
	await flush()
	assert.ok(
		actor.getSnapshot().matches({ MAIN_ACTIVITY: { COMBAT: 'WAITING' } })
	)
	assert.equal(bot.pvp.target, undefined)
	actor.send({ type: 'UPDATE_HEALTH', health: 8 })
	assert.ok(
		actor
			.getSnapshot()
			.matches({ MAIN_ACTIVITY: { URGENT_NEEDS: 'EMERGENCY_HEALING' } })
	)
})
