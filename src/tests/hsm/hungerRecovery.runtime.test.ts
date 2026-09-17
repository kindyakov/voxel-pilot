import assert from 'node:assert/strict'
import test from 'node:test'
import { setImmediate as flush } from 'node:timers/promises'

import { Vec3 } from 'vec3'

import { loadAutoEat } from '@/modules/plugins/autoEat.js'

import { ItemFactory, createHarness, registry } from './fixtures/handoffBot.js'

test('an active hunger meal continues inside the 30/20 band and stops at 20 without fleeing', async t => {
	t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] })
	const { bot, actor, enemy, observe } = createHarness()
	t.after(() => actor.stop())
	loadAutoEat(bot.asBot())
	const bread = new ItemFactory(registry.itemsByName.bread.id, 16)
	bread.slot = 36
	bot.inventory.items = () => [bread]
	bot.food = 5
	actor.send({ type: 'UPDATE_FOOD', food: 5 })
	enemy.position.x = 31
	observe()
	for (let i = 0; i < 5; i++) {
		t.mock.timers.tick(100)
		await flush()
	}
	assert.equal(bot.usingItem, true)
	const uses = bot.itemUses
	for (const distance of [29, 25, 20.01]) {
		enemy.position.x = distance
		observe()
		t.mock.timers.tick(100)
		await flush()
		assert.equal(bot.usingItem, true, `meal must continue at ${distance}`)
		assert.equal(bot.itemUses, uses)
	}
	enemy.position.x = 20
	observe()
	t.mock.timers.tick(100)
	await flush()
	assert.equal(bot.usingItem, false)
	assert.ok(actor.getSnapshot().matches({ MAIN_ACTIVITY: 'IDLE' }))
	assert.equal(bot.controlState.forward, false)
	enemy.position.x = 25
	observe()
	t.mock.timers.tick(500)
	await flush()
	assert.equal(bot.usingItem, false, 'a new meal still needs 30 blocks')
})

test('healthy hunger does not preempt fighting a nearby hostile or start flight', async t => {
	t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] })
	const { bot, actor, observe } = createHarness()
	t.after(() => actor.stop())
	actor.send({ type: 'UPDATE_FOOD', food: 5 })
	observe()
	await flush()
	t.mock.timers.tick(1000)
	await flush()
	assert.ok(
		actor
			.getSnapshot()
			.matches({ MAIN_ACTIVITY: { COMBAT: 'MELEE_ATTACKING' } })
	)
	assert.equal(bot.pvp.target?.id, 1)
	assert.equal(bot.usingItem, false)
})

test('hunger-only recovery leaves safe no-food waiting once, and resumes when food appears', async t => {
	t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] })
	const { bot, actor, enemy } = createHarness(true)
	const observe = () => {
		bot.entities = { 1: enemy }
	}
	t.after(() => actor.stop())
	loadAutoEat(bot.asBot())
	bot.food = 5
	actor.send({ type: 'UPDATE_FOOD', food: 5 })
	enemy.position = new Vec3(40, 64, 0)
	observe()
	await flush()
	t.mock.timers.tick(100)
	await flush()
	t.mock.timers.tick(100)
	await flush()
	assert.ok(actor.getSnapshot().matches({ MAIN_ACTIVITY: 'IDLE' }))
	for (let i = 0; i < 5; i++) {
		actor.send({ type: 'UPDATE_FOOD', food: 5 })
		observe()
		t.mock.timers.tick(100)
		await flush()
		assert.ok(actor.getSnapshot().matches({ MAIN_ACTIVITY: 'IDLE' }))
	}
	assert.equal(bot.chatMessages.length, 1)
	const bread = new ItemFactory(registry.itemsByName.bread.id, 1)
	bread.slot = 36
	bot.inventory.items = () => [bread]
	observe()
	await flush()
	t.mock.timers.tick(100)
	await flush()
	t.mock.timers.tick(100)
	await flush()
	assert.equal(bot.usingItem, true)
	actor.send({ type: 'UPDATE_HEALTH', health: 8 })
	actor.send({ type: 'UPDATE_HEALTH', health: 12 })
	actor.send({ type: 'RECOVERY_FAILED', cause: 'no_food', reason: 'no food' })
	assert.ok(
		actor
			.getSnapshot()
			.matches({ MAIN_ACTIVITY: { URGENT_NEEDS: 'EMERGENCY_HEALING' } })
	)
})

test('damage stops hunger-only eating without flight, and leaving the damaged place restores eating', async t => {
	t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] })
	const { bot, actor, step } = createHarness(true)
	t.after(() => actor.stop())
	loadAutoEat(bot.asBot())
	const bread = new ItemFactory(registry.itemsByName.bread.id, 16)
	bread.slot = 36
	bot.inventory.items = () => [bread]
	bot.food = 5
	actor.send({ type: 'UPDATE_FOOD', food: 5 })
	await flush()
	for (let i = 0; i < 5; i++) {
		t.mock.timers.tick(100)
		await flush()
	}
	assert.equal(bot.usingItem, true)
	bot.emit('entityHurt', bot.entity)
	assert.equal(bot.usingItem, false)
	for (let i = 0; i < 20; i++) {
		t.mock.timers.tick(50)
		await flush()
		step()
	}
	assert.equal(bot.entity.position.x, 0)
	assert.equal(bot.entity.position.z, 0)
	assert.equal(
		bot.usingItem,
		false,
		'do not restart eating at the place where damage interrupted it'
	)
	// A later task or server movement leaves that place; hunger itself does not flee.
	bot.entity.position.x = 20
	actor.send({ type: 'UPDATE_POSITION', position: bot.entity.position })
	for (let i = 0; i < 5; i++) {
		t.mock.timers.tick(100)
		await flush()
	}
	assert.equal(bot.usingItem, true)
})
