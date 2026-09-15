import assert from 'node:assert/strict'
import test from 'node:test'
import { setImmediate as flush } from 'node:timers/promises'

import { Vec3 } from 'vec3'

import { loadAutoEat } from '@/modules/plugins/autoEat'

import { ItemFactory, createHarness, registry } from './fixtures/handoffBot'

test('regeneration holds the safe band and resumes escape only at the danger boundary', async t => {
	t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] })
	const { actor, enemy, observe } = createHarness(false, '1.20.6')
	t.after(() => actor.stop())
	actor.send({ type: 'UPDATE_HEALTH', health: 8 })
	await flush()
	for (const [distance, resting] of [
		[30.2, true],
		[29.9, true],
		[30.1, true],
		[29.8, true],
		[25, true],
		[20.1, true],
		[20, false],
		[25, false],
		[30, true]
	] as const) {
		enemy.position = new Vec3(distance, 64, 0)
		observe()
		t.mock.timers.tick(100)
		await flush()
		assert.equal(
			actor.getSnapshot().context.movementOwner === 'NONE',
			resting,
			`distance ${distance}`
		)
	}
	actor.send({ type: 'UPDATE_HEALTH', health: 18 })
	enemy.position = new Vec3(25, 64, 0)
	observe()
	t.mock.timers.tick(100)
	await flush()
	assert.ok(
		actor
			.getSnapshot()
			.matches({ MAIN_ACTIVITY: { URGENT_NEEDS: 'EMERGENCY_HEALING' } })
	)
	assert.notEqual(actor.getSnapshot().context.movementOwner, 'NONE')
	enemy.position = new Vec3(30, 64, 0)
	observe()
	t.mock.timers.tick(100)
	await flush()
	assert.ok(actor.getSnapshot().matches({ MAIN_ACTIVITY: 'IDLE' }))
})

for (const invalidation of ['damage', 'stale', 'invalid', 'retry'])
	test(`the resting band does not survive ${invalidation}`, async t => {
		t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] })
		const { actor, enemy, observe } = createHarness()
		t.after(() => actor.stop())
		actor.send({ type: 'UPDATE_HEALTH', health: 8 })
		await flush()
		for (const distance of [30, 25]) {
			enemy.position = new Vec3(distance, 64, 0)
			observe()
			t.mock.timers.tick(100)
			await flush()
			assert.equal(actor.getSnapshot().context.movementOwner, 'NONE')
		}
		if (invalidation === 'damage')
			actor.send({
				type: 'DAMAGE_OBSERVED',
				sourceId: enemy.id,
				sourcePosition: enemy.position
			})
		if (invalidation === 'stale') {
			t.mock.timers.tick(2100)
			await flush()
		}
		if (invalidation === 'invalid') {
			actor.send({
				type: 'THREAT_OBSERVATION_INVALID',
				reason: 'invalid_bot_position'
			})
			t.mock.timers.tick(100)
			await flush()
		}
		if (invalidation === 'retry') {
			actor.send({ type: 'ERROR', error: 'test recovery restart' })
			t.mock.timers.tick(1000)
			await flush()
		}
		observe()
		t.mock.timers.tick(100)
		await flush()
		assert.notEqual(actor.getSnapshot().context.movementOwner, 'NONE')
		assert.ok(
			actor
				.getSnapshot()
				.matches({ MAIN_ACTIVITY: { URGENT_NEEDS: 'EMERGENCY_HEALING' } })
		)
	})

test('a new meal after regeneration requires reaching 30 again', async t => {
	t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] })
	const { bot, actor, enemy, observe } = createHarness()
	t.after(() => actor.stop())
	loadAutoEat(bot.asBot())
	const bread = new ItemFactory(registry.itemsByName.bread.id, 16)
	bread.slot = 36
	bot.inventory.items = () => [bread]
	actor.send({ type: 'UPDATE_HEALTH', health: 8 })
	await flush()
	for (const distance of [30, 25]) {
		enemy.position = new Vec3(distance, 64, 0)
		observe()
		t.mock.timers.tick(100)
		await flush()
		assert.equal(actor.getSnapshot().context.movementOwner, 'NONE')
	}
	bot.food = 17
	actor.send({ type: 'UPDATE_FOOD', food: 17 })
	observe()
	t.mock.timers.tick(100)
	await flush()
	assert.equal(bot.usingItem, false)
	assert.notEqual(actor.getSnapshot().context.movementOwner, 'NONE')
	enemy.position = new Vec3(30, 64, 0)
	observe()
	t.mock.timers.tick(100)
	await flush()
	assert.equal(bot.usingItem, true)
})

test('finishing one portion in the safety band does not authorize the next portion', async t => {
	t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] })
	const { bot, actor, enemy, observe } = createHarness()
	t.after(() => actor.stop())
	loadAutoEat(bot.asBot())
	const bread = new ItemFactory(registry.itemsByName.bread.id, 16)
	bread.slot = 36
	bot.inventory.slots[36] = bread
	bot.inventory.items = () => [bread]
	bot.food = 5
	actor.send({ type: 'UPDATE_FOOD', food: 5 })
	actor.send({ type: 'UPDATE_HEALTH', health: 8 })
	await flush()
	const advance = async (distance: number) => {
		enemy.position = new Vec3(distance, 64, 0)
		observe()
		t.mock.timers.tick(100)
		await flush()
	}
	await advance(31)
	assert.equal(bot.usingItem, true)
	await advance(25)
	assert.equal(bot.usingItem, true)
	bot.food = 10
	actor.send({ type: 'UPDATE_FOOD', food: 10 })
	bot.usingItem = false
	bot._client.emit('entity_status', {
		entityId: bot.entity.id,
		entityStatus: 9
	})
	await flush()
	const uses = bot.itemUses
	await advance(25)
	assert.equal(bot.itemUses, uses)
	assert.equal(bot.usingItem, false)
	assert.notEqual(actor.getSnapshot().context.movementOwner, 'NONE')
	await advance(31)
	assert.equal(bot.usingItem, true)
	assert.equal(bot.itemUses, uses + 1)
})
