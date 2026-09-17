import assert from 'node:assert/strict'
import test from 'node:test'
import { setImmediate as flush } from 'node:timers/promises'

import Logger from '@/config/logger.js'

import combatGuards from '@/hsm/guards/combat.guards.js'
import {
	hasFreshThreatObservation,
	isRecoverySafe
} from '@/hsm/guards/survival.guards.js'

import { loadAutoEat } from '@/modules/plugins/autoEat.js'

import { ItemFactory, createHarness, registry } from './fixtures/handoffBot.js'

test('invalid observation interrupts ranged combat into a stopped observation wait', t => {
	const { bot, actor, enemy } = createHarness()
	t.after(() => actor.stop())
	bot.inventory.items = () => [
		new ItemFactory(registry.itemsByName.bow.id, 1),
		new ItemFactory(registry.itemsByName.arrow.id, 32)
	]
	enemy.position.x = 8
	const context = {
		...actor.getSnapshot().context,
		combatTarget: { entity: enemy, distance: 8 },
		threatObservationProblem: 'invalid_entity_position' as const
	}
	assert.equal(
		combatGuards.canSkirmishRanged({
			context,
			event: { type: 'UPDATE_HEALTH', health: 20 }
		}),
		false
	)
	actor.send({ type: 'START_COMBAT', target: enemy })
	assert.ok(
		actor
			.getSnapshot()
			.matches({ MAIN_ACTIVITY: { COMBAT: 'RANGED_SKIRMISHING' } })
	)
	actor.send({
		type: 'THREAT_OBSERVATION_INVALID',
		reason: 'invalid_entity_position'
	})
	assert.ok(actor.getSnapshot().matches({ MAIN_ACTIVITY: 'OBSERVATION_WAIT' }))
})

for (const invalid of [NaN, Infinity, -Infinity]) {
	test(`invalid position ${invalid} is not fresh/safe and recovery resumes after valid observation`, async t => {
		t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] })
		const { bot, actor, enemy, step } = createHarness(true, '1.20.6')
		t.after(() => actor.stop())
		const warnings: string[] = []
		t.mock.method(Logger, 'warn', (message: string) => {
			warnings.push(message)
		})
		bot.entities = { 1: enemy }
		bot.entity.position.x = invalid
		bot.entity.position.z = invalid
		bot.emit('entityHurt', bot.entity, enemy)
		actor.send({ type: 'UPDATE_HEALTH', health: 8 })
		await flush()
		for (let i = 0; i < 5; i++) {
			t.mock.timers.tick(100)
			await flush()
		}
		assert.equal(hasFreshThreatObservation(actor.getSnapshot().context), false)
		assert.equal(isRecoverySafe(actor.getSnapshot().context), false)
		assert.equal(bot.itemUses, 0)
		assert.equal(bot.attacks.length, 0)
		assert.equal(bot.controlState.forward, false)
		assert.equal(
			bot.chatMessages.filter(message => /еды нет/i.test(message)).length,
			1
		)
		assert.equal(
			warnings.filter(message => message === '[OBSERVATION] invalid').length,
			1
		)
		// A server correction supplies real coordinates; do not invent replacement coordinates.
		bot.entity.position.set(0, 64, 0)
		assert.equal(
			isRecoverySafe(actor.getSnapshot().context),
			false,
			'correction alone is not a fresh scan'
		)
		for (let i = 0; i < 30; i++) {
			t.mock.timers.tick(50)
			await flush()
			step()
		}
		assert.ok(bot.entity.position.x < -2)
		assert.equal(actor.getSnapshot().context.nearestThreat?.entityId, enemy.id)
		assert.ok(
			actor
				.getSnapshot()
				.matches({ MAIN_ACTIVITY: { URGENT_NEEDS: 'EMERGENCY_HEALING' } })
		)
	})
}

test('invalid coordinates interrupt actual eating and cannot release recovery even after health restoration', async t => {
	t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] })
	const { bot, actor } = createHarness(true)
	t.after(() => actor.stop())
	loadAutoEat(bot.asBot())
	const bread = new ItemFactory(registry.itemsByName.bread.id, 16)
	bread.slot = 36
	bot.inventory.items = () => [bread]
	bot.food = 8
	actor.send({ type: 'UPDATE_FOOD', food: 8 })
	actor.send({ type: 'UPDATE_HEALTH', health: 8 })
	await flush()
	for (let i = 0; i < 4; i++) {
		t.mock.timers.tick(100)
		await flush()
	}
	assert.equal(bot.usingItem, true)
	bot.entity.position.x = NaN
	for (let i = 0; i < 4; i++) {
		t.mock.timers.tick(100)
		await flush()
	}
	assert.equal(bot.usingItem, false)
	const uses = bot.itemUses
	actor.send({ type: 'UPDATE_HEALTH', health: 20 })
	actor.send({ type: 'HEALTH_RESTORED' })
	for (let i = 0; i < 4; i++) {
		t.mock.timers.tick(100)
		await flush()
	}
	assert.equal(bot.itemUses, uses)
	assert.ok(
		actor
			.getSnapshot()
			.matches({ MAIN_ACTIVITY: { URGENT_NEEDS: 'EMERGENCY_HEALING' } })
	)
	bot.entity.position.x = 0
	for (let i = 0; i < 4; i++) {
		t.mock.timers.tick(100)
		await flush()
	}
	assert.ok(actor.getSnapshot().matches({ MAIN_ACTIVITY: 'IDLE' }))
})

test('invalid enemy coordinates do not erase a known threat and stop an active fight', async t => {
	t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] })
	const { bot, actor, enemy, step } = createHarness(true)
	t.after(() => actor.stop())
	bot.entities = { 1: enemy }
	await flush()
	for (let i = 0; i < 20; i++) {
		t.mock.timers.tick(50)
		await flush()
		step()
	}
	assert.ok(bot.attacks.length > 0)
	enemy.position.x = NaN
	for (let i = 0; i < 3; i++) {
		t.mock.timers.tick(100)
		await flush()
	}
	assert.equal(actor.getSnapshot().context.nearestThreat?.entityId, enemy.id)
	assert.equal(isRecoverySafe(actor.getSnapshot().context), false)
	assert.equal(bot.pvp.target, undefined)
	assert.equal(bot.controlState.forward, false)
	assert.ok(actor.getSnapshot().matches({ MAIN_ACTIVITY: 'OBSERVATION_WAIT' }))
})

test('damage while coordinates are invalid cannot poison the required relocation after correction', async t => {
	t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] })
	const { bot, actor, step } = createHarness(true)
	t.after(() => actor.stop())
	loadAutoEat(bot.asBot())
	const bread = new ItemFactory(registry.itemsByName.bread.id, 16)
	bread.slot = 36
	bot.inventory.items = () => [bread]
	bot.food = 8
	actor.send({ type: 'UPDATE_FOOD', food: 8 })
	actor.send({ type: 'UPDATE_HEALTH', health: 8 })
	await flush()
	for (let i = 0; i < 4; i++) {
		t.mock.timers.tick(100)
		await flush()
	}
	assert.equal(bot.usingItem, true)
	bot.entity.position.x = NaN
	bot.emit('entityHurt', bot.entity)
	assert.equal(bot.usingItem, false)
	t.mock.timers.tick(200)
	await flush()
	assert.equal(isRecoverySafe(actor.getSnapshot().context), false)
	bot.entity.position.set(0, 64, 0)
	for (let i = 0; i < 4; i++) {
		t.mock.timers.tick(100)
		await flush()
	}
	assert.equal(
		bot.usingItem,
		false,
		'valid coordinates do not erase the obligation to leave the damaged eating place'
	)
	for (let i = 0; i < 240 && !bot.usingItem; i++) {
		step()
		t.mock.timers.tick(50)
		await flush()
	}
	assert.ok(
		Math.hypot(bot.entity.position.x, bot.entity.position.z) >=
			actor.getSnapshot().context.preferences.fleeTargetDistance - 1
	)
	assert.equal(
		bot.usingItem,
		true,
		'actual relocation after correction must restore eating safety'
	)
})
