import assert from 'node:assert/strict'
import test from 'node:test'
import { setImmediate as flush } from 'node:timers/promises'

import { Vec3 } from 'vec3'

import { loadHawkeye } from '@/modules/plugins/hawkeye'

import {
	ItemFactory,
	createEntityFixture,
	createHarness,
	registry
} from './fixtures/handoffBot'

test('a swelling creeper outside the selected target interrupts melee and cannot restart melee after defusing', async t => {
	t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] })
	const { bot, actor, enemy, step } = createHarness(true)
	t.after(() => actor.stop())
	bot.inventory.items = () => [
		new ItemFactory(registry.itemsByName.iron_sword.id, 1)
	]
	const creeper = createEntityFixture({
		...enemy,
		id: 2,
		name: 'creeper',
		position: new Vec3(3, 64, 0),
		metadata: []
	})
	const keys: string[] = registry.entitiesByName.creeper.metadataKeys
	Object.assign(creeper.metadata, {
		[keys.indexOf('swell_dir')]: -1,
		[keys.indexOf('is_ignited')]: false,
		[keys.indexOf('is_powered')]: false
	})
	bot.entities = { 1: enemy, 2: creeper }
	await flush()
	for (let i = 0; i < 6; i++) {
		t.mock.timers.tick(100)
		await flush()
	}
	assert.equal(bot.pvp.target?.id, 1)
	Object.assign(creeper.metadata, { [keys.indexOf('swell_dir')]: 1 })
	t.mock.timers.tick(100)
	await flush()
	assert.ok(
		actor.getSnapshot().matches({ MAIN_ACTIVITY: { COMBAT: 'RETREATING' } })
	)
	for (let i = 0; i < 20; i++) {
		t.mock.timers.tick(50)
		await flush()
		step()
	}
	assert.ok(bot.entity.position.x < -2)
	Object.assign(creeper.metadata, { [keys.indexOf('swell_dir')]: -1 })
	delete bot.entities[1]
	for (let i = 0; i < 20; i++) {
		t.mock.timers.tick(100)
		await flush()
	}
	assert.equal(bot.pvp.target, undefined)
	assert.ok(!bot.attacks.includes(creeper.id))
	creeper.position = bot.entity.position.offset(35, 0, 0)
	for (let i = 0; i < 4; i++) {
		t.mock.timers.tick(100)
		await flush()
	}
	assert.ok(actor.getSnapshot().matches({ MAIN_ACTIVITY: 'IDLE' }))
	creeper.position = bot.entity.position.offset(2, 0, 0)
	for (let i = 0; i < 8; i++) {
		t.mock.timers.tick(100)
		await flush()
		step()
	}
	assert.equal(bot.pvp.target, undefined)
	assert.ok(!bot.attacks.includes(creeper.id))
})

test('a creeper disengagement can use a real ranged controller without approaching again', async t => {
	t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] })
	const { bot, actor, enemy } = createHarness(true)
	t.after(() => actor.stop())
	loadHawkeye(bot.asBot())
	bot.inventory.items = () => [
		new ItemFactory(registry.itemsByName.bow.id, 1),
		new ItemFactory(registry.itemsByName.arrow.id, 16)
	]
	enemy.name = 'creeper'
	const keys: string[] = registry.entitiesByName.creeper.metadataKeys
	Object.assign(enemy.metadata, {
		[keys.indexOf('swell_dir')]: 1,
		[keys.indexOf('is_ignited')]: false,
		[keys.indexOf('is_powered')]: false
	})
	bot.entities = { 1: enemy }
	await flush()
	t.mock.timers.tick(100)
	await flush()
	assert.ok(
		actor.getSnapshot().matches({ MAIN_ACTIVITY: { COMBAT: 'RETREATING' } })
	)
	enemy.position.x = 17
	for (let i = 0; i < 8; i++) {
		t.mock.timers.tick(100)
		await flush()
	}
	assert.ok(
		actor
			.getSnapshot()
			.matches({ MAIN_ACTIVITY: { COMBAT: 'RANGED_SKIRMISHING' } })
	)
	assert.equal(bot.pvp.target, undefined)
})

test('creeper retreat keeps a distance margin before restarting ranged combat', async t => {
	t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] })
	const { bot, actor, enemy, observe } = createHarness()
	t.after(() => actor.stop())
	loadHawkeye(bot.asBot())
	const bow = new ItemFactory(registry.itemsByName.bow.id, 1)
	bow.slot = 36
	bot.inventory.slots[36] = bow
	bot.inventory.items = () => [
		bow,
		new ItemFactory(registry.itemsByName.arrow.id, 16)
	]
	enemy.name = 'creeper'
	enemy.metadata = []
	const advance = async (distance: number) => {
		enemy.position = bot.entity.position.offset(distance, 0, 0)
		observe()
		t.mock.timers.tick(100)
		await flush()
	}
	await advance(11.8)
	for (const distance of [12.1, 12.4, 11.9, 13, 15.9]) {
		await advance(distance)
		// A delayed completion event must obey the same boundary as the actor.
		actor.send({ type: 'RETREAT_SAFE' })
		assert.ok(
			actor.getSnapshot().matches({ MAIN_ACTIVITY: { COMBAT: 'RETREATING' } })
		)
	}
	await advance(16.1)
	await advance(16.1)
	assert.ok(
		actor
			.getSnapshot()
			.matches({ MAIN_ACTIVITY: { COMBAT: 'RANGED_SKIRMISHING' } })
	)
})

test('a defused creeper does not prolong retreat or mask a nearby attackable zombie', async t => {
	t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] })
	const { bot, actor, enemy } = createHarness(true)
	t.after(() => actor.stop())
	const creeper = createEntityFixture({
		...enemy,
		id: 2,
		name: 'creeper',
		position: new Vec3(1, 64, 0),
		metadata: []
	})
	const keys: string[] = registry.entitiesByName.creeper.metadataKeys
	Object.assign(creeper.metadata, {
		[keys.indexOf('swell_dir')]: 1,
		[keys.indexOf('is_ignited')]: false,
		[keys.indexOf('is_powered')]: false
	})
	bot.entities = { 1: enemy, 2: creeper }
	await flush()
	for (let i = 0; i < 4; i++) {
		t.mock.timers.tick(100)
		await flush()
	}
	assert.ok(
		actor.getSnapshot().matches({ MAIN_ACTIVITY: { COMBAT: 'RETREATING' } })
	)
	Object.assign(creeper.metadata, { [keys.indexOf('swell_dir')]: -1 })
	for (let i = 0; i < 10; i++) {
		t.mock.timers.tick(100)
		await flush()
	}
	assert.ok(
		actor
			.getSnapshot()
			.matches({ MAIN_ACTIVITY: { COMBAT: 'MELEE_ATTACKING' } })
	)
	assert.equal(bot.pvp.target?.id, enemy.id)
	assert.equal(bot.attacks.includes(creeper.id), false)
	Object.assign(creeper.metadata, { [keys.indexOf('swell_dir')]: 1 })
	for (let i = 0; i < 4; i++) {
		t.mock.timers.tick(100)
		await flush()
	}
	assert.ok(
		actor.getSnapshot().matches({ MAIN_ACTIVITY: { COMBAT: 'RETREATING' } })
	)
	actor.send({ type: 'UPDATE_HEALTH', health: 8 })
	assert.ok(
		actor
			.getSnapshot()
			.matches({ MAIN_ACTIVITY: { URGENT_NEEDS: 'EMERGENCY_HEALING' } })
	)
})
