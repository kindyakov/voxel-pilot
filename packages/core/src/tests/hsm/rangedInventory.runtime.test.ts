import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import test from 'node:test'
import { setImmediate as flush } from 'node:timers/promises'

import { Weapons } from 'minecrafthawkeye'
import itemLoader from 'prismarine-item'

import type { Bot, Item } from '@/types/index.js'

import { loadHawkeye } from '@/modules/plugins/hawkeye.js'

import { createEntityFixture, createHarness } from './fixtures/handoffBot.js'

const require = createRequire(import.meta.url)
const loadInventory: (
	bot: Bot,
	options: { hideErrors: boolean }
) => void = require('mineflayer/lib/plugins/inventory')
const loadSimpleInventory: (
	bot: Bot
) => void = require('mineflayer/lib/plugins/simple_inventory')

const fixture = (t: test.TestContext) => {
	t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] })
	const harness = createHarness(false, '1.20.6')
	const { bot, actor } = harness
	t.after(() => actor.stop())
	const ItemFactory = itemLoader(bot.version)
	const packets: { name: string; status?: number }[] = []
	const chargeDurations: number[] = []
	let chargeAt: number | null = null
	Object.assign(bot, {
		supportFeature: (feature: string) => bot.registry.supportFeature(feature),
		swingArm: () => {}
	})
	Object.assign(bot._client, {
		write: (name: string, packet: { status?: number }) => {
			packets.push({ name, status: packet.status })
			// Server handleSetCarriedItem cancels main-hand use without releasing it.
			if (name === 'held_item_slot') chargeAt = null
			if (name === 'use_item') chargeAt = Date.now()
			if (name === 'block_dig' && packet.status === 5 && chargeAt !== null) {
				chargeDurations.push(Date.now() - chargeAt)
				chargeAt = null
			}
		}
	})
	loadInventory(bot.asBot(), { hideErrors: true })
	loadSimpleInventory(bot.asBot())
	bot.asBot().quickBarSlot = 0
	const sync = (slot: number, item: Item | null) => {
		bot._client.emit('set_slot', {
			windowId: 0,
			stateId: 1,
			slot,
			item: ItemFactory.toNotch(item)
		})
	}
	sync(36, new ItemFactory(bot.registry.itemsByName.iron_sword.id, 1))
	sync(37, new ItemFactory(bot.registry.itemsByName.bow.id, 1))
	sync(38, new ItemFactory(bot.registry.itemsByName.arrow.id, 64))
	loadHawkeye(bot.asBot())
	const attack = t.mock.method(bot.asBot().hawkEye, 'autoAttack')
	const equip = t.mock.method(bot, 'equip')
	const advance = async (ms: number) => {
		for (let elapsed = 0; elapsed < ms; elapsed += 50) {
			t.mock.timers.tick(50)
			await flush()
			bot.emit('physicsTick')
			await flush()
		}
	}
	return {
		...harness,
		ItemFactory,
		sync,
		attack,
		equip,
		advance,
		packets,
		chargeDurations
	}
}

for (const packetName of ['set_slot', 'window_items'] as const) {
	test(`${packetName}: server bow updates preserve full charge and do not restart the same target`, async t => {
		const {
			bot,
			enemy,
			observe,
			ItemFactory,
			attack,
			equip,
			advance,
			packets,
			chargeDurations
		} = fixture(t)
		enemy.position.x = 18
		observe()
		await flush()
		await advance(1500)
		for (let damage = 1; damage <= 12; damage++) {
			const previous = bot.heldItem
			const bow = {
				...ItemFactory.toNotch(previous),
				addedComponentCount: 1,
				components: [{ type: 'damage', data: damage }]
			}
			if (packetName === 'set_slot') {
				bot._client.emit(packetName, {
					windowId: 0,
					stateId: damage + 1,
					slot: 37,
					item: bow
				})
			} else {
				const items = bot.inventory.slots.map(item => ItemFactory.toNotch(item))
				items[37] = bow
				bot._client.emit(packetName, {
					windowId: 0,
					stateId: damage + 1,
					items,
					carriedItem: ItemFactory.toNotch(null)
				})
			}
			assert.notEqual(
				bot.heldItem,
				previous,
				'Native decoding replaces the Item object'
			)
			assert.equal(bot.heldItem?.durabilityUsed, damage)
			await advance(250)
		}
		assert.equal(
			attack.mock.callCount(),
			1,
			'The target and weapon kind did not change'
		)
		assert.equal(
			equip.mock.callCount(),
			1,
			'Inventory sync must not cause another equip'
		)
		assert.ok(
			chargeDurations.length >= 3,
			'Several shots must actually be released'
		)
		assert.ok(
			chargeDurations.every(duration => duration >= 1200),
			`Interrupted bow draws: ${chargeDurations.join(', ')}ms`
		)
		assert.equal(
			packets.some(packet => packet.name === 'window_click'),
			false
		)
		assert.equal(
			packets.some(
				packet =>
					packet.name === 'block_dig' &&
					(packet.status === 3 || packet.status === 4)
			),
			false
		)
	})
}

test('inventory refresh during successful equip does not postpone the first ranged attack', async t => {
	const { bot, enemy, observe, attack, sync, ItemFactory } = fixture(t)
	const nativeEquip = bot.equip.bind(bot)
	t.mock.method(bot, 'equip', async (item: Item, destination: string) => {
		await nativeEquip(item, destination)
		sync(37, new ItemFactory(bot.registry.itemsByName.bow.id, 1))
	})
	enemy.position.x = 18
	observe()
	await flush()
	assert.equal(attack.mock.callCount(), 1)
	assert.equal(Date.now(), 0)
})

test('a removed bow is replaced through native equip and shooting resumes once', async t => {
	const { bot, enemy, observe, attack, equip, sync, ItemFactory, advance } =
		fixture(t)
	enemy.position.x = 18
	observe()
	await flush()
	await advance(1500)
	sync(37, null)
	sync(39, new ItemFactory(bot.registry.itemsByName.bow.id, 1))
	await advance(500)
	assert.equal(bot.asBot().quickBarSlot, 3)
	assert.equal(bot.heldItem?.name, 'bow')
	assert.equal(equip.mock.callCount(), 2)
	assert.equal(attack.mock.callCount(), 2)
	await advance(1500)
	assert.equal(attack.mock.callCount(), 2)
})

test('a real target change retargets once without re-equipping the same bow', async t => {
	const { bot, actor, enemy, observe, attack, equip, advance } = fixture(t)
	enemy.position.x = 18
	observe()
	await flush()
	await advance(1500)
	const next = createEntityFixture({
		id: 2,
		name: 'zombie',
		type: enemy.type,
		isValid: true,
		height: 1.8,
		position: enemy.position.offset(-2, 0, 0)
	})
	actor.send({
		type: 'UPDATE_ENTITIES',
		entities: [enemy, next],
		enemies: [enemy, next],
		players: []
	})
	actor.send({
		type: 'UPDATE_COMBAT_TARGET',
		combatTarget: { entity: next, distance: 16 }
	})
	await advance(500)
	assert.equal(attack.mock.callCount(), 2)
	assert.equal(attack.mock.calls[1]?.arguments[0], next)
	assert.equal(equip.mock.callCount(), 1)
	await advance(1500)
	assert.equal(attack.mock.callCount(), 2)
	assert.equal(bot.heldItem?.name, 'bow')
})

test('changing targets during a bow draw preserves its charge instead of releasing early', async t => {
	const { bot, actor, enemy, observe, advance, chargeDurations, packets } =
		fixture(t)
	enemy.position.x = 18
	observe()
	await flush()
	await advance(300)
	const next = createEntityFixture({
		...enemy,
		id: 2,
		position: enemy.position.offset(-2, 0, 0)
	})
	actor.send({
		type: 'UPDATE_ENTITIES',
		entities: [enemy, next],
		enemies: [enemy, next],
		players: []
	})
	actor.send({
		type: 'UPDATE_COMBAT_TARGET',
		combatTarget: { entity: next, distance: 16 }
	})
	await advance(1000)
	assert.deepEqual(chargeDurations, [1250])
	assert.equal(packets.filter(packet => packet.name === 'use_item').length, 1)
	assert.equal(bot.heldItem?.name, 'bow')
})

test('canceling a partial draw releases no arrow and a new controller can fire a full shot', async t => {
	const { bot, actor, enemy, observe, advance, packets, chargeDurations } =
		fixture(t)
	enemy.position.x = 18
	observe()
	await flush()
	await advance(300)
	const releasesBefore = packets.filter(
		packet => packet.name === 'block_dig' && packet.status === 5
	).length
	actor.send({ type: 'STOP_COMBAT' })
	await flush()
	assert.ok(actor.getSnapshot().matches({ MAIN_ACTIVITY: 'IDLE' }))
	assert.equal(
		packets.filter(packet => packet.name === 'block_dig' && packet.status === 5)
			.length,
		releasesBefore
	)
	assert.deepEqual(chargeDurations, [])
	assert.equal(bot.asBot().quickBarSlot, 1)
	assert.equal(bot.heldItem?.name, 'bow')
	bot.asBot().hawkEye.autoAttack(enemy, Weapons.bow)
	await advance(1300)
	assert.deepEqual(chargeDurations, [1250])
	bot.asBot().hawkEye.stop()
})

test('changing the active hotbar slot resets the interrupted draw even with another bow', async t => {
	const { bot, enemy, observe, attack, equip, sync, ItemFactory, advance } =
		fixture(t)
	enemy.position.x = 18
	observe()
	await flush()
	await advance(1500)
	sync(39, new ItemFactory(bot.registry.itemsByName.bow.id, 1))
	bot.asBot().setQuickBarSlot(3)
	await advance(500)
	assert.equal(attack.mock.callCount(), 2)
	assert.equal(equip.mock.callCount(), 1)
	await advance(1500)
	assert.equal(attack.mock.callCount(), 2)
})
