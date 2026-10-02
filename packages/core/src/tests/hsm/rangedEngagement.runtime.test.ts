import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import test from 'node:test'
import { setImmediate as flush } from 'node:timers/promises'

import type { Entity, Item } from '@/types/index.js'

import { loadHawkeye } from '@/modules/plugins/hawkeye.js'

import { createEntityFixture, createHarness } from './fixtures/handoffBot.js'

const fixture = (t: test.TestContext, tracking = false) => {
	t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] })
	const harness = createHarness(tracking, '1.20.6')
	const { bot, actor } = harness
	t.after(() => actor.stop())
	const ItemFactory = createRequire(import.meta.url)('prismarine-item')(
		bot.version
	)
	const sword = bot.inventory.items()[0]!
	const bow: Item = new ItemFactory(bot.registry.itemsByName.bow.id, 1)
	const arrows: Item = new ItemFactory(bot.registry.itemsByName.arrow.id, 64)
	bot.inventory.items = () => [sword, bow, arrows]
	loadHawkeye(bot.asBot())
	const attack = t.mock.method(bot.asBot().hawkEye, 'autoAttack')
	const advance = async (ms: number) => {
		for (let elapsed = 0; elapsed < ms; elapsed += 50) {
			t.mock.timers.tick(50)
			await flush()
		}
	}
	return { ...harness, sword, bow, arrows, attack, advance }
}

for (const species of ['zombie', 'skeleton']) {
	test(`${species}: bow starts at 25 blocks, stays active beyond 20, and stops outside 25`, async t => {
		const { bot, actor, enemy, advance, attack } = fixture(t, true)
		enemy.name = species
		enemy.position.x = 25.1
		bot.entities[enemy.id] = enemy
		await advance(500)
		assert.ok(actor.getSnapshot().matches({ MAIN_ACTIVITY: 'IDLE' }))
		assert.equal(attack.mock.callCount(), 0)
		enemy.position.x = 25
		await advance(500)
		assert.ok(
			actor
				.getSnapshot()
				.matches({ MAIN_ACTIVITY: { COMBAT: 'RANGED_SKIRMISHING' } })
		)
		assert.equal(attack.mock.callCount(), 1)
		const children = Object.values(actor.getSnapshot().children)
		await advance(1000)
		assert.deepEqual(Object.values(actor.getSnapshot().children), children)
		assert.equal(
			attack.mock.callCount(),
			1,
			'Observation must not restart the shot at 20–25 blocks'
		)
		enemy.position.x = 25.1
		bot.emit('physicsTick')
		await advance(200)
		assert.ok(actor.getSnapshot().matches({ MAIN_ACTIVITY: 'IDLE' }))
		assert.equal(bot.usingItem, false)
		assert.equal(bot.pvp.target, undefined)
	})
}

test('ranged startup activates the real bow on the next physics tick without a 250ms wait', async t => {
	const { bot, enemy, observe, attack } = fixture(t)
	enemy.position.x = 8
	observe()
	await flush()
	assert.equal(attack.mock.callCount(), 1)
	bot.emit('physicsTick')
	assert.equal(bot.itemUses, 1)
	assert.equal(Date.now(), 0)
})

test('an approaching zombie allows several actual bow charge/release cycles before melee', async t => {
	const { bot, actor, enemy, advance, attack, step } = fixture(t, true)
	const release = t.mock.method(bot, 'deactivateItem')
	enemy.position.x = 25
	bot.entities[enemy.id] = enemy
	await advance(200)
	assert.ok(
		actor
			.getSnapshot()
			.matches({ MAIN_ACTIVITY: { COMBAT: 'RANGED_SKIRMISHING' } })
	)
	for (let tick = 0; tick < 80; tick++) {
		enemy.position.x -= 0.15
		await advance(50)
		bot.emit('physicsTick')
		await flush()
	}
	assert.equal(
		attack.mock.callCount(),
		1,
		'Keep the same firing controller while approaching'
	)
	assert.ok(
		release.mock.callCount() >= 3,
		'The real HawkEye must release several charged shots, not just receive autoAttack'
	)
	assert.equal(bot.pvp.target, undefined)
	assert.equal(
		bot.entity.position.x,
		0,
		'Ranged defense must not pursue the target'
	)
	enemy.position.x = 5
	bot.emit('physicsTick')
	await flush()
	assert.ok(
		actor
			.getSnapshot()
			.matches({ MAIN_ACTIVITY: { COMBAT: 'MELEE_ATTACKING' } })
	)
	assert.equal(bot.pvp.target, enemy)
	const from = bot.entity.position.clone()
	for (let tick = 0; tick < 15; tick++) {
		step()
		await flush()
	}
	assert.ok(
		bot.entity.position.distanceTo(from) > 1,
		'The real melee controller must actually close the distance'
	)
})

test('live melee boundary overrides stale target distance without re-equipping the bow', async t => {
	const { bot, actor, enemy, observe, advance } = fixture(t)
	enemy.position.x = 8
	observe()
	await advance(300)
	enemy.position.x = 5.2
	observe()
	await flush()
	assert.equal(actor.getSnapshot().context.combatTarget.distance, 5.2)
	enemy.position.x = 5
	bot.emit('physicsTick')
	await flush()
	assert.ok(
		actor
			.getSnapshot()
			.matches({ MAIN_ACTIVITY: { COMBAT: 'MELEE_ATTACKING' } })
	)
	assert.equal(bot.pvp.target, enemy)
	assert.deepEqual(bot.equippedItems, ['bow', 'iron_sword'])
	for (const distance of [5.1, 4.9, 6.4]) {
		enemy.position.x = distance
		observe()
		bot.emit('physicsTick')
		await flush()
		assert.ok(
			actor
				.getSnapshot()
				.matches({ MAIN_ACTIVITY: { COMBAT: 'MELEE_ATTACKING' } })
		)
	}
	enemy.position.x = 6.6
	bot.emit('physicsTick')
	await flush()
	assert.ok(
		actor
			.getSnapshot()
			.matches({ MAIN_ACTIVITY: { COMBAT: 'RANGED_SKIRMISHING' } })
	)
})

test('a delayed observer event cannot choose a weapon using its old distance', async t => {
	const { bot, actor, enemy, observe } = fixture(t)
	enemy.position.x = 8
	observe()
	await flush()
	enemy.position.x = 4.9
	actor.send({
		type: 'UPDATE_COMBAT_TARGET',
		combatTarget: { entity: enemy, distance: 5.2 }
	})
	await flush()
	assert.ok(
		actor
			.getSnapshot()
			.matches({ MAIN_ACTIVITY: { COMBAT: 'MELEE_ATTACKING' } })
	)
	assert.deepEqual(bot.equippedItems, ['bow', 'iron_sword'])
	enemy.position.x = 6.6
	actor.send({
		type: 'UPDATE_COMBAT_TARGET',
		combatTarget: { entity: enemy, distance: 6.4 }
	})
	await flush()
	assert.ok(
		actor
			.getSnapshot()
			.matches({ MAIN_ACTIVITY: { COMBAT: 'RANGED_SKIRMISHING' } })
	)
})

for (const change of [
	'close',
	'outside',
	'lost_arrows',
	'sight',
	'death',
	'stop',
	'survival'
] as const) {
	test(`pending bow equip revalidates ${change} before starting an attack`, async t => {
		const { bot, actor, enemy, observe, sword, bow, attack } = fixture(t)
		let finishEquip = () => {}
		bot.equipGate = new Promise<void>(resolve => {
			finishEquip = resolve
		})
		enemy.position.x = 8
		observe()
		await flush()
		assert.deepEqual(bot.equippedItems, ['bow'])
		assert.equal(attack.mock.callCount(), 0)
		if (change === 'close') enemy.position.x = 4
		if (change === 'outside') enemy.position.x = 26
		if (change === 'lost_arrows') bot.inventory.items = () => [sword, bow]
		if (change === 'sight')
			bot.solidAt = position =>
				position.y < 64 || (position.x >= 3 && position.x <= 4)
		if (change === 'death') actor.send({ type: 'ENTITY_DIED', entity: enemy })
		if (change === 'stop') actor.send({ type: 'STOP_COMBAT' })
		if (change === 'survival') actor.send({ type: 'UPDATE_HEALTH', health: 8 })
		finishEquip()
		await flush()
		assert.equal(attack.mock.callCount(), 0)
		assert.equal(bot.itemUses, 0)
		if (change === 'close' || change === 'lost_arrows') {
			assert.ok(
				actor
					.getSnapshot()
					.matches({ MAIN_ACTIVITY: { COMBAT: 'MELEE_ATTACKING' } })
			)
			assert.equal(bot.pvp.target, enemy)
		}
		if (change === 'outside' || change === 'sight' || change === 'death') {
			assert.ok(actor.getSnapshot().matches({ MAIN_ACTIVITY: 'IDLE' }))
		}
	})
}

test('bow loss at long range does not authorize a new melee pursuit', async t => {
	const { bot, actor, enemy, sword, bow, advance } = fixture(t, true)
	enemy.position.x = 24
	bot.entities[enemy.id] = enemy
	await advance(500)
	assert.ok(
		actor
			.getSnapshot()
			.matches({ MAIN_ACTIVITY: { COMBAT: 'RANGED_SKIRMISHING' } })
	)
	bot.inventory.items = () => [sword, bow]
	bot.emit('physicsTick')
	await advance(300)
	assert.ok(actor.getSnapshot().matches({ MAIN_ACTIVITY: 'IDLE' }))
	assert.equal(bot.pvp.target, undefined)
	assert.equal(bot.usingItem, false)
})

test('25-block ranged admission still requires a hostile visible mob and ammunition', async t => {
	const { bot, actor, enemy, sword, bow, advance, attack } = fixture(t, true)
	enemy.position.x = 24
	bot.entities[enemy.id] = enemy
	bot.inventory.items = () => [sword, bow]
	await advance(300)
	assert.ok(actor.getSnapshot().matches({ MAIN_ACTIVITY: 'IDLE' }))
	const ItemFactory = createRequire(import.meta.url)('prismarine-item')(
		bot.version
	)
	const arrows: Item = new ItemFactory(bot.registry.itemsByName.arrow.id, 64)
	bot.inventory.items = () => [sword, bow, arrows]
	for (const name of ['villager', 'warden', 'enderman']) {
		enemy.name = name
		await advance(300)
		assert.ok(actor.getSnapshot().matches({ MAIN_ACTIVITY: 'IDLE' }), name)
	}
	enemy.name = 'zombie'
	bot.solidAt = position =>
		position.y < 64 || (position.x >= 10 && position.x <= 11)
	await advance(300)
	assert.ok(actor.getSnapshot().matches({ MAIN_ACTIVITY: 'IDLE' }))
	assert.equal(attack.mock.callCount(), 0)
})

test('target changing during bow equip starts only the current target', async t => {
	const { bot, actor, enemy, observe, attack } = fixture(t)
	let finishEquip = () => {}
	bot.equipGate = new Promise<void>(resolve => {
		finishEquip = resolve
	})
	enemy.position.x = 8
	observe()
	await flush()
	const next: Entity = createEntityFixture({
		id: 2,
		name: 'zombie',
		type: enemy.type,
		isValid: true,
		height: 1.8,
		position: enemy.position.offset(-1, 0, 0)
	})
	actor.send({
		type: 'UPDATE_ENTITIES',
		entities: [],
		enemies: [enemy, next],
		players: []
	})
	actor.send({
		type: 'UPDATE_COMBAT_TARGET',
		combatTarget: { entity: next, distance: 7 }
	})
	finishEquip()
	await flush()
	assert.equal(attack.mock.callCount(), 1)
	assert.equal(attack.mock.calls[0]?.arguments[0], next)
})
