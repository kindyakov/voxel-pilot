import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import test from 'node:test'
import { setImmediate as flush } from 'node:timers/promises'

import { initAutoEat, loadAutoEat } from '@/modules/plugins/autoEat'

import {
	HandoffBot,
	ItemFactory,
	createHarness,
	registry
} from './fixtures/handoffBot'

const require = createRequire(import.meta.url)
const deferred = () => {
	let resolve = () => {}
	const promise = new Promise<void>(done => {
		resolve = done
	})
	return { promise, resolve }
}

for (const stage of ['equip', 'restore'] as const) {
	for (const ending of ['timeout', 'cancel'] as const) {
		test(`${ending} releases an eating attempt blocked in ${stage}, without affecting its replacement`, async t => {
			t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] })
			const bot = new HandoffBot()
			loadAutoEat(bot.asBot())
			initAutoEat(bot.asBot())
			bot.asBot().autoEat.setOpts({ eatingTimeout: 1000 })
			const bread = new ItemFactory(registry.itemsByName.bread.id, 16)
			bread.slot = 9
			const sword = new ItemFactory(registry.itemsByName.iron_sword.id, 1)
			sword.slot = 36
			bot.inventory.slots[36] = sword
			bot.inventory.items = () => [bread, sword]
			bot.food = 8
			const oldEquip = deferred()
			if (stage === 'equip') bot.equipGate = oldEquip.promise
			let oldOutcome: string | null = null
			const oldAttempt = bot.utils.eating().then(
				() => {
					oldOutcome = 'success'
				},
				error => {
					oldOutcome = error.message
				}
			)
			await flush()
			if (stage === 'restore') {
				assert.equal(bot.usingItem, true)
				bot.equipGate = oldEquip.promise
				bot._client.emit('entity_status', {
					entityId: bot.entity.id,
					entityStatus: 9
				})
				bot.usingItem = false
				await flush()
				assert.deepEqual(bot.equippedItems, ['bread', 'iron_sword'])
			}
			if (ending === 'cancel') bot.utils.stopEating()
			else t.mock.timers.tick(1000)
			await flush()
			assert.match(
				oldOutcome ?? '',
				ending === 'cancel' ? /cancel/i : /timed out/i
			)
			assert.equal(bot.asBot().autoEat.isEating, false)
			assert.equal(bot.usingItem, false)
			assert.equal(bot._client.listenerCount('entity_status'), 0)
			assert.equal(bot.inventory.listenerCount('updateSlot'), 0)
			await oldAttempt

			bot.equipGate = Promise.resolve()
			const newAttempt = bot.utils.eating()
			await flush()
			assert.equal(
				bot.usingItem,
				true,
				'A fresh attempt can consume before the old equip settles'
			)
			const uses = bot.itemUses
			oldEquip.resolve()
			await flush()
			assert.equal(
				bot.usingItem,
				true,
				'Old completion cannot deactivate the new use'
			)
			assert.equal(bot.asBot().autoEat.isEating, true)
			assert.equal(bot.itemUses, uses, 'Old completion cannot reactivate food')
			bot._client.emit('entity_status', {
				entityId: bot.entity.id,
				entityStatus: 9
			})
			bot.usingItem = false
			await newAttempt
			assert.equal(bot.asBot().autoEat.isEating, false)
			assert.equal(bot._client.listenerCount('entity_status'), 0)
			assert.equal(bot.inventory.listenerCount('updateSlot'), 0)
		})
	}
}

test('the eating deadline covers elapsed equip time as well as consumption', async t => {
	t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] })
	const bot = new HandoffBot()
	loadAutoEat(bot.asBot())
	const bread = new ItemFactory(registry.itemsByName.bread.id, 16)
	bread.slot = 9
	bot.inventory.items = () => [bread]
	bot.food = 8
	bot.asBot().autoEat.setOpts({ eatingTimeout: 1000 })
	const equip = deferred()
	bot.equipGate = equip.promise
	let failure = ''
	const attempt = bot.utils.eating().catch(error => {
		failure = error.message
	})
	t.mock.timers.tick(900)
	equip.resolve()
	await flush()
	assert.equal(bot.usingItem, true)
	t.mock.timers.tick(100)
	await flush()
	assert.match(failure, /timed out/i)
	assert.equal(bot.usingItem, false)
	await attempt
})

test('canceling native food equip preserves the food in inventory and permits a fresh meal', async t => {
	t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] })
	const bot = new HandoffBot()
	Object.assign(bot, {
		supportFeature: (feature: string) => bot.registry.supportFeature(feature)
	})
	const packets: string[] = []
	Object.assign(bot._client, {
		write: (name: string) => {
			packets.push(name)
		}
	})
	require('mineflayer/lib/plugins/inventory')(bot, { hideErrors: true })
	require('mineflayer/lib/plugins/simple_inventory')(bot)
	const native = bot.asBot()
	Object.assign(native, { quickBarSlot: 0, lastDigTime: Date.now() })
	const bread = new ItemFactory(registry.itemsByName.bread.id, 16)
	bread.slot = 9
	const sword = new ItemFactory(registry.itemsByName.iron_sword.id, 1)
	sword.slot = 36
	native.inventory.slots[9] = bread
	native.inventory.slots[36] = sword
	const controller = new AbortController()
	let failure = ''
	const attempt = native
		.equip(bread, 'hand', { signal: controller.signal })
		.catch(error => {
			failure = error.message
		})
	await flush()
	controller.abort(new Error('Equip canceled by handoff'))
	await native.equip(sword, 'hand')
	const clicksAtHandoff = packets.filter(name => name === 'window_click').length
	t.mock.timers.tick(1000)
	await flush()
	assert.ok(failure === '' || /canceled/i.test(failure))
	assert.equal(
		packets.filter(name => name === 'window_click').length,
		clicksAtHandoff
	)
	assert.equal(native.heldItem?.name, 'iron_sword')
	assert.equal(
		native.inventory.selectedItem,
		null,
		'Cancellation must not strand food on the cursor'
	)
	assert.ok(native.inventory.items().some(item => item.name === 'bread'))
	await attempt
	loadAutoEat(native)
	initAutoEat(native)
	bot.food = 8
	const meal = bot.utils.eating()
	await flush()
	t.mock.timers.tick(1000)
	await flush()
	assert.equal(native.heldItem?.name, 'bread')
	assert.ok(packets.includes('use_item'))
	bot.utils.stopEating()
	await assert.rejects(meal, /cancel/i)
})

test('critical flight continues while canceled food equip is still pending', async t => {
	t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] })
	const { bot, actor, enemy, observe, step } = createHarness()
	t.after(() => actor.stop())
	loadAutoEat(bot.asBot())
	const bread = new ItemFactory(registry.itemsByName.bread.id, 16)
	bread.slot = 9
	bot.inventory.items = () => [bread]
	bot.food = 8
	const equip = deferred()
	bot.equipGate = equip.promise
	actor.send({
		type: 'UPDATE_ENTITIES',
		entities: [],
		enemies: [],
		players: []
	})
	actor.send({ type: 'UPDATE_FOOD', food: 8 })
	actor.send({ type: 'UPDATE_HEALTH', health: 8 })
	await flush()
	t.mock.timers.tick(100)
	await flush()
	assert.equal(bot.asBot().autoEat.isEating, true)
	observe()
	t.mock.timers.tick(100)
	await flush()
	assert.equal(bot.asBot().autoEat.isEating, false)
	const before = bot.entity.position.distanceTo(enemy.position)
	for (let i = 0; i < 20; i++) {
		step()
		t.mock.timers.tick(50)
		await flush()
	}
	assert.ok(bot.entity.position.distanceTo(enemy.position) > before + 2)
	equip.resolve()
	await flush()
	assert.equal(bot.itemUses, 0)
	assert.equal(bot.usingItem, false)
})

test('an expired eating attempt retries inside the same health obligation', async t => {
	t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] })
	const { bot, actor } = createHarness()
	t.after(() => actor.stop())
	loadAutoEat(bot.asBot())
	initAutoEat(bot.asBot())
	bot.asBot().autoEat.setOpts({ eatingTimeout: 300 })
	const bread = new ItemFactory(registry.itemsByName.bread.id, 16)
	bread.slot = 9
	bot.inventory.items = () => [bread]
	bot.food = 8
	const oldEquip = deferred()
	bot.equipGate = oldEquip.promise
	actor.send({ type: 'UPDATE_FOOD', food: 8 })
	actor.send({ type: 'UPDATE_HEALTH', health: 8 })
	await flush()
	const tick = async () => {
		actor.send({
			type: 'UPDATE_ENTITIES',
			entities: [],
			enemies: [],
			players: []
		})
		t.mock.timers.tick(100)
		await flush()
	}
	for (let i = 0; i < 4; i++) await tick()
	assert.ok(
		actor.getSnapshot().matches({
			MAIN_ACTIVITY: { URGENT_NEEDS: { EMERGENCY_HEALING: 'RETRYING' } }
		})
	)
	assert.equal(bot.asBot().autoEat.isEating, false)
	bot.equipGate = Promise.resolve()
	for (let i = 0; i < 12; i++) await tick()
	assert.ok(
		actor.getSnapshot().matches({
			MAIN_ACTIVITY: { URGENT_NEEDS: { EMERGENCY_HEALING: 'RUNNING' } }
		})
	)
	assert.equal(bot.usingItem, true)
	oldEquip.resolve()
	await flush()
	assert.equal(bot.usingItem, true)
	assert.equal(bot.itemUses, 1)
})
