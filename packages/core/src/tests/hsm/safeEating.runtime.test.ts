import assert from 'node:assert/strict'
import test from 'node:test'
import { setImmediate as flush } from 'node:timers/promises'

import { Vec3 } from 'vec3'

import { createBotMachine } from '@/hsm/machine.js'

import { loadAutoEat } from '@/modules/plugins/autoEat.js'

import { ItemFactory, createHarness, registry } from './fixtures/handoffBot.js'

test('recovery cannot eat without fresh observer evidence', async t => {
	t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] })
	const { bot, actor } = createHarness()
	t.after(() => actor.stop())
	loadAutoEat(bot.asBot())
	const bread = new ItemFactory(registry.itemsByName.bread.id, 16)
	bread.slot = 36
	bot.inventory.items = () => [bread]
	bot.food = 8
	actor.send({ type: 'UPDATE_FOOD', food: 8 })
	actor.send({ type: 'UPDATE_HEALTH', health: 8 })
	await flush()
	t.mock.timers.tick(100)
	await flush()
	assert.equal(bot.usingItem, false)
	actor.send({
		type: 'UPDATE_ENTITIES',
		entities: [],
		enemies: [],
		players: []
	})
	t.mock.timers.tick(100)
	await flush()
	assert.equal(bot.usingItem, true)
	t.mock.timers.tick(2100)
	await flush()
	assert.equal(
		bot.usingItem,
		false,
		'stale empty observations are not proof of safety'
	)
})

test('critical no-food alert is delivered during flight, once per inventory condition', async t => {
	t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] })
	const { bot, actor, observe } = createHarness()
	t.after(() => actor.stop())
	bot.inventory.items = () => []
	actor.send({ type: 'UPDATE_HEALTH', health: 8 })
	observe()
	await flush()
	for (let i = 0; i < 5; i++) {
		t.mock.timers.tick(100)
		await flush()
	}
	assert.equal(
		bot.chatMessages.filter(message => /еды нет/i.test(message)).length,
		1
	)
})

test('contradictory eating boundaries are rejected at machine construction', () => {
	assert.throws(
		() =>
			createBotMachine({
				preferences: { safeEatDistance: 20, interruptEatDistance: 30 }
			}),
		/distance/i
	)
	for (const preferences of [
		{ recoveryRetryMs: 0 },
		{ escapeRouteAttempts: 1.5 },
		{ approachChangedConditionRetries: -1 },
		{ movementProgressDistance: NaN },
		{ healthEmergency: 18, healthFullyRestored: 10 }
	]) {
		assert.throws(
			() => createBotMachine({ preferences }),
			/preference|threshold/i
		)
	}
})

test('a ranged hit while eating invalidates the position even beyond the distance boundary', async t => {
	t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] })
	const { bot, actor, enemy, observe, step } = createHarness()
	t.after(() => actor.stop())
	loadAutoEat(bot.asBot())
	const bread = new ItemFactory(registry.itemsByName.bread.id, 16)
	bread.slot = 36
	bot.inventory.items = () => [bread]
	bot.food = 8
	actor.send({ type: 'UPDATE_FOOD', food: 8 })
	actor.send({ type: 'UPDATE_HEALTH', health: 8 })
	enemy.position = new Vec3(35, 64, 0)
	observe()
	await flush()
	t.mock.timers.tick(100)
	await flush()
	assert.equal(bot.usingItem, true)
	bot.emit('entityHurt', bot.entity, enemy)
	t.mock.timers.tick(100)
	await flush()
	assert.equal(bot.usingItem, false)
	for (let i = 0; i < 20; i++) {
		step()
		t.mock.timers.tick(50)
		await flush()
	}
	assert.ok(bot.entity.position.x < -2)
	assert.equal(bot.usingItem, false)
})

for (const failure of ['route', 'immediate']) {
	test(`unknown-source damage and ${failure} failure cannot restore eating safety without displacement`, async t => {
		t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] })
		const { bot, actor, enemy, observe } = createHarness()
		t.after(() => actor.stop())
		loadAutoEat(bot.asBot())
		const bread = new ItemFactory(registry.itemsByName.bread.id, 16)
		bread.slot = 36
		bot.inventory.items = () => [bread]
		bot.food = 8
		actor.send({ type: 'UPDATE_FOOD', food: 8 })
		actor.send({ type: 'UPDATE_HEALTH', health: 8 })
		enemy.position = new Vec3(35, 64, 0)
		observe()
		await flush()
		t.mock.timers.tick(100)
		await flush()
		assert.equal(bot.usingItem, true)
		const blockAt = bot.blockAt.bind(bot)
		bot.blockAt = () => {
			throw new Error('world temporarily unavailable')
		}
		bot.emit('entityHurt', bot.entity)
		if (failure === 'immediate')
			actor.send({ type: 'ERROR', error: 'food failed before next tick' })
		t.mock.timers.tick(100)
		await flush()
		bot.blockAt = blockAt
		for (let i = 0; i < 15; i++) {
			t.mock.timers.tick(100)
			await flush()
		}
		assert.equal(
			bot.usingItem,
			false,
			'retry must preserve the invalidated position'
		)
	})
}

test('eating starts at 30, continues in the band, stops at 20 and does not restart at 25', async t => {
	t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] })
	const { bot, actor, enemy, observe } = createHarness()
	t.after(() => actor.stop())
	loadAutoEat(bot.asBot())
	const bread = new ItemFactory(registry.itemsByName.bread.id, 16)
	bread.slot = 36
	bot.inventory.items = () => [bread]
	bot.food = 8
	actor.send({ type: 'UPDATE_FOOD', food: 8 })
	actor.send({ type: 'UPDATE_HEALTH', health: 8 })
	await flush()
	for (const [distance, eating] of [
		[29.9, false],
		[30, true],
		[30.1, true],
		[25, true],
		[20.1, true],
		[20, false],
		[19.9, false],
		[25, false],
		[30, true]
	] as const) {
		enemy.position = new Vec3(distance, 64, 0)
		observe()
		t.mock.timers.tick(100)
		await flush()
		assert.equal(bot.usingItem, eating, `distance ${distance}`)
	}
})
