import assert from 'node:assert/strict'
import test from 'node:test'
import { setImmediate as flush } from 'node:timers/promises'

import type { Item } from '@/types'

import { initAutoEat, loadAutoEat } from '@/modules/plugins/autoEat'
import { loadHawkeye } from '@/modules/plugins/hawkeye'

import { ItemFactory, createHarness, registry } from './fixtures/handoffBot'

test('canceling an unfinished melee start cannot reacquire movement from survival', async t => {
	t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] })
	const { bot, actor, enemy, observe, step } = createHarness()
	t.after(() => actor.stop())
	observe()
	await flush()
	// The real melee actor starts PVP, whose stop/attack handoff yields a microtask.
	t.mock.timers.tick(500)
	actor.send({ type: 'UPDATE_HEALTH', health: 8 })
	await flush()
	t.mock.timers.tick(100)
	await flush()
	const before = bot.entity.position.distanceTo(enemy.position)
	for (let tick = 0; tick < 20; tick++) {
		step()
		await flush()
	}
	assert.equal(
		bot.pvp.target,
		undefined,
		'Canceled PVP must not reacquire its target'
	)
	assert.deepEqual(bot.attacks, [], 'No attack may escape the canceled actor')
	assert.ok(
		bot.entity.position.distanceTo(enemy.position) > before + 2,
		'Survival must keep moving away over multiple physics ticks'
	)
})

test('an old PVP path-stop timeout cannot clear the escape route or other listeners', async t => {
	t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] })
	const { bot, actor, enemy, observe } = createHarness()
	t.after(() => actor.stop())
	observe()
	await flush()
	t.mock.timers.tick(500)
	await flush()
	assert.equal(
		bot.pvp.target,
		enemy,
		'The old PVP operation must actually start'
	)
	enemy.position.x = 18
	observe()
	bot.emit('entityGone', enemy)
	const unrelatedListener = () => {}
	bot.on('path_stop', unrelatedListener)
	actor.send({ type: 'UPDATE_HEALTH', health: 8 })
	await flush()
	// Search may yield partial results; readiness is not guaranteed in one slice.
	for (let tick = 0; tick < 20 && !bot.pathfinder.goal; tick++) {
		observe()
		t.mock.timers.tick(100)
		await flush()
	}
	assert.ok(bot.pathfinder.goal, 'Survival has issued its escape route')
	t.mock.timers.tick(5000)
	await flush()
	assert.ok(
		bot.pathfinder.goal,
		'Late combat cleanup must not clear the escape route'
	)
	assert.ok(
		bot.listeners('path_stop').includes(unrelatedListener),
		'Combat must not remove another subscriber'
	)
})

test('survival releases the shield raised by autonomous creeper defense', async t => {
	t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] })
	const { bot, actor, enemy, observe, step } = createHarness()
	t.after(() => actor.stop())
	bot.inventory.slots[45] = new ItemFactory(registry.itemsByName.shield.id, 1)
	Object.assign(enemy, { name: 'creeper', metadata: [] })
	const keys: string[] = registry.entitiesByName.creeper.metadataKeys
	Object.assign(enemy.metadata, {
		[keys.indexOf('swell_dir')]: -1,
		[keys.indexOf('is_ignited')]: false,
		[keys.indexOf('is_powered')]: false
	})
	observe()
	await flush()
	t.mock.timers.tick(500)
	await flush()
	Object.assign(enemy.metadata, { [keys.indexOf('swell_dir')]: 1 })
	step()
	assert.ok(
		bot.itemUses > 0,
		'The real PVP plugin raised the shield before the next observation'
	)
	assert.equal(
		bot.usingItem,
		false,
		'The new creeper observation cancels autonomous shielding'
	)
	actor.send({ type: 'UPDATE_HEALTH', health: 8 })
	await flush()
	t.mock.timers.tick(100)
	await flush()
	assert.equal(
		bot.usingItem,
		false,
		'Combat must release item use before escape'
	)
	const before = bot.entity.position.distanceTo(enemy.position)
	for (let tick = 0; tick < 20; tick++) {
		step()
		await flush()
	}
	assert.ok(bot.entity.position.distanceTo(enemy.position) > before + 2)
})

test('canceling food during equip cannot start eating after escape begins', async t => {
	t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] })
	const { bot, actor, enemy, observe, step } = createHarness()
	t.after(() => actor.stop())
	loadAutoEat(bot.asBot())
	actor.send({
		type: 'UPDATE_ENTITIES',
		entities: [],
		enemies: [],
		players: []
	})
	const bread: Item = new ItemFactory(registry.itemsByName.bread.id, 1)
	bread.slot = 36
	bot.inventory.items = () => [bread]
	let finishEquip = () => {}
	bot.equipGate = new Promise<void>(resolve => {
		finishEquip = resolve
	})
	bot.food = 8
	actor.send({ type: 'UPDATE_FOOD', food: 8 })
	actor.send({ type: 'UPDATE_HEALTH', health: 8 })
	await flush()
	t.mock.timers.tick(100)
	await flush()
	assert.equal(bot.asBot().autoEat.isEating, true)
	observe()
	t.mock.timers.tick(100)
	await flush()
	const before = bot.entity.position.distanceTo(enemy.position)
	finishEquip()
	await flush()
	assert.equal(
		bot.itemUses,
		0,
		'Canceled equip must not continue into food activation'
	)
	for (let tick = 0; tick < 20; tick++) {
		step()
		await flush()
	}
	assert.ok(bot.entity.position.distanceTo(enemy.position) > before + 2)
	assert.equal(bot.asBot().autoEat.isEating, false)
	assert.equal(bot._client.listenerCount('entity_status'), 0)
})

test('a ranged physics callback queued before preemption cannot reactivate item use', async t => {
	t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] })
	const { bot, actor, enemy, observe } = createHarness()
	t.after(() => actor.stop())
	loadHawkeye(bot.asBot())
	bot.inventory.items = () => [
		new ItemFactory(registry.itemsByName.bow.id, 1),
		new ItemFactory(registry.itemsByName.arrow.id, 16)
	]
	enemy.position.x = 8
	// A health packet arrives during a tick whose listener list already includes ranged combat.
	bot.once('physicsTick', () =>
		actor.send({ type: 'UPDATE_HEALTH', health: 8 })
	)
	observe()
	await flush()
	t.mock.timers.tick(250)
	await flush()
	assert.ok(
		actor
			.getSnapshot()
			.matches({ MAIN_ACTIVITY: { COMBAT: 'RANGED_SKIRMISHING' } })
	)
	bot.emit('physicsTick')
	await flush()
	assert.equal(
		bot.itemUses,
		0,
		'An already queued ranged callback must respect stop'
	)
	assert.equal(bot.usingItem, false)
})

test('a canceled food equip rejection cannot perform late inventory recovery', async t => {
	t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] })
	const { bot, actor, observe } = createHarness()
	t.after(() => actor.stop())
	loadAutoEat(bot.asBot())
	actor.send({
		type: 'UPDATE_ENTITIES',
		entities: [],
		enemies: [],
		players: []
	})
	initAutoEat(bot.asBot())
	const bread: Item = new ItemFactory(registry.itemsByName.bread.id, 1)
	bread.slot = 36
	bot.inventory.items = () => [bread]
	bot.inventory.selectedItem = bread
	let rejectEquip = (_error: Error) => {}
	bot.equipGate = new Promise<void>((_resolve, reject) => {
		rejectEquip = reject
	})
	bot.food = 8
	actor.send({ type: 'UPDATE_FOOD', food: 8 })
	actor.send({ type: 'UPDATE_HEALTH', health: 8 })
	await flush()
	t.mock.timers.tick(100)
	await flush()
	assert.equal(bot.asBot().autoEat.isEating, true)
	observe()
	t.mock.timers.tick(100)
	await flush()
	rejectEquip(new Error('Server rejected old equip'))
	await flush()
	assert.deepEqual(
		bot.inventoryClicks,
		[],
		'Canceled food cannot click or drop the inventory cursor'
	)
	assert.equal(bot.itemUses, 0)
	assert.equal(bot.asBot().autoEat.isEating, false)
})

test('a pathfinder equip completing after preemption cannot start old digging', async t => {
	t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] })
	const { bot, actor, enemy, observe } = createHarness()
	t.after(() => actor.stop())
	bot.inventory.items = () => [
		new ItemFactory(registry.itemsByName.iron_pickaxe.id, 1),
		new ItemFactory(registry.itemsByName.iron_sword.id, 1)
	]
	enemy.position.x = 5
	observe()
	await flush()
	let finishEquip = () => {}
	bot.equipGate = new Promise<void>(resolve => {
		finishEquip = resolve
	})
	t.mock.timers.tick(500)
	await flush()
	bot.solidAt = position =>
		position.y < 64 || (Math.floor(position.x) === 1 && position.y < 67)
	bot.emit('physicsTick')
	await flush()
	assert.ok(
		bot.equippedItems.includes('iron_pickaxe'),
		'The real pathfinder is waiting to equip for digging'
	)
	const otherDiggingListener = () => {}
	bot.on('diggingAborted', otherDiggingListener)
	actor.send({ type: 'UPDATE_HEALTH', health: 8 })
	await flush()
	t.mock.timers.tick(100)
	await flush()
	finishEquip()
	await flush()
	assert.deepEqual(
		bot.digCalls,
		[],
		'A canceled route must not start digging after its equip resolves'
	)
	assert.ok(
		bot.listeners('diggingAborted').includes(otherDiggingListener),
		'Canceling a route must preserve unrelated digging subscribers'
	)
	assert.equal(bot.controlState.forward, true)
})

test('a pathfinder placement equip cannot continue on a canceled route', async t => {
	t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] })
	const { bot, actor, enemy, observe } = createHarness()
	t.after(() => actor.stop())
	bot.solidAt = position => position.y < 64 && Math.floor(position.x) !== 1
	bot.movements.allowParkour = false
	bot.movements.canDig = false
	Object.assign(bot.pathfinder, { LOSWhenPlacingBlocks: false })
	bot.inventory.items = () => [
		new ItemFactory(registry.itemsByName.cobblestone.id, 16),
		new ItemFactory(registry.itemsByName.iron_sword.id, 1)
	]
	enemy.position.x = 5
	observe()
	await flush()
	let finishEquip = () => {}
	bot.equipGate = new Promise<void>(resolve => {
		finishEquip = resolve
	})
	t.mock.timers.tick(500)
	await flush()
	bot.emit('physicsTick')
	await flush()
	assert.ok(
		bot.equippedItems.includes('cobblestone'),
		'The route is waiting for a building item'
	)
	actor.send({ type: 'UPDATE_HEALTH', health: 8 })
	await flush()
	t.mock.timers.tick(100)
	await flush()
	finishEquip()
	await flush()
	assert.deepEqual(bot.placeCalls, [], 'Canceled route must not place a block')
})

for (const ending of ['death', 'stop'] as const) {
	test(`${ending} cancels an aimed attack, including reuse of the same target after death`, async t => {
		t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] })
		const { bot, actor, observe } = createHarness()
		t.after(() => actor.stop())
		let finishAim = () => {}
		bot.aimGate = new Promise<void>(resolve => {
			finishAim = resolve
		})
		observe()
		await flush()
		t.mock.timers.tick(500)
		await flush()
		bot.emit('physicTick')
		await flush()
		assert.deepEqual(
			bot.attacks,
			[],
			'The attack is waiting for aim completion'
		)
		if (ending === 'stop') actor.stop()
		else {
			actor.send({ type: 'DEATH' })
			actor.send({ type: 'UPDATE_HEALTH', health: 20 })
			observe()
			await flush()
			t.mock.timers.tick(500)
			await flush()
		}
		finishAim()
		await flush()
		assert.deepEqual(
			bot.attacks,
			[],
			'Completion from the old invocation must not attack'
		)
		if (ending === 'death') {
			bot.emit('physicTick')
			await flush()
			assert.deepEqual(
				bot.attacks,
				[1],
				'A fresh invocation can still attack normally'
			)
		}
		actor.stop()
		t.mock.timers.tick(6000)
		await flush()
		assert.equal(bot.pvp.target, undefined)
		assert.equal(bot.usingItem, false)
	})

	test(`${ending} cancels active food without restoring the previous owner's item`, async t => {
		t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] })
		const { bot, actor } = createHarness()
		t.after(() => actor.stop())
		loadAutoEat(bot.asBot())
		actor.send({
			type: 'UPDATE_ENTITIES',
			entities: [],
			enemies: [],
			players: []
		})
		const bread: Item = new ItemFactory(registry.itemsByName.bread.id, 1)
		bread.slot = 36
		bot.inventory.items = () => [bread]
		bot.inventory.slots[36] = new ItemFactory(
			registry.itemsByName.wooden_sword.id,
			1
		)
		bot.food = 8
		actor.send({ type: 'UPDATE_FOOD', food: 8 })
		actor.send({ type: 'UPDATE_HEALTH', health: 8 })
		await flush()
		t.mock.timers.tick(100)
		await flush()
		assert.equal(bot.usingItem, true)
		if (ending === 'stop') actor.stop()
		else actor.send({ type: 'DEATH' })
		await flush()
		t.mock.timers.tick(10_000)
		await flush()
		assert.deepEqual(
			bot.equippedItems,
			['bread'],
			'Canceled food must not re-equip the old sword'
		)
		assert.equal(bot.usingItem, false)
		assert.equal(bot.asBot().autoEat.isEating, false)
		assert.equal(bot._client.listenerCount('entity_status'), 0)
		assert.equal(bot.inventory.listenerCount('updateSlot'), 0)
	})
}

test('food success clears its observers and allows another eating attempt', async t => {
	t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] })
	const { bot, actor } = createHarness()
	t.after(() => actor.stop())
	loadAutoEat(bot.asBot())
	actor.send({
		type: 'UPDATE_ENTITIES',
		entities: [],
		enemies: [],
		players: []
	})
	const bread: Item = new ItemFactory(registry.itemsByName.bread.id, 2)
	bread.slot = 36
	bot.inventory.items = () => [bread]
	bot.food = 8
	actor.send({ type: 'UPDATE_FOOD', food: 8 })
	actor.send({ type: 'UPDATE_HEALTH', health: 8 })
	await flush()
	for (let attempt = 1; attempt <= 2; attempt++) {
		t.mock.timers.tick(100)
		await flush()
		assert.equal(bot.itemUses, attempt)
		bot._client.emit('entity_status', {
			entityId: bot.entity.id,
			entityStatus: 9
		})
		bot.usingItem = false // The simulated server finished consuming.
		await flush()
		assert.equal(bot.asBot().autoEat.isEating, false)
		assert.equal(bot._client.listenerCount('entity_status'), 0)
		assert.equal(bot.inventory.listenerCount('updateSlot'), 0)
	}
})
