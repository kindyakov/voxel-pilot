import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import test from 'node:test'
import { setImmediate as flush } from 'node:timers/promises'

import type { Entity } from '@/types/index.js'

import { ItemFactory, createHarness } from './fixtures/handoffBot.js'

const require = createRequire(import.meta.url)

/** Public HSM, real PVP, native inventory and physics; only the server is replaced. */
const fixture = (t: test.TestContext) => {
	t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] })
	const harness = createHarness()
	const { bot, actor } = harness
	t.after(() => actor.stop())
	const packets: { name: string; mode?: number; status?: number }[] = []
	Object.assign(bot, {
		supportFeature: (feature: string) => bot.registry.supportFeature(feature)
	})
	Object.assign(bot._client, {
		write: (name: string, packet: { mode?: number; status?: number }) =>
			packets.push({ name, ...packet })
	})
	require('mineflayer/lib/plugins/inventory')(bot, { hideErrors: true })
	require('mineflayer/lib/plugins/simple_inventory')(bot)
	bot.asBot().quickBarSlot = 0
	const put = (slot: number, name: string) => {
		const item = new ItemFactory(bot.registry.itemsByName[name].id, 1)
		item.slot = slot
		bot.inventory.slots[slot] = item
		bot.asBot().updateHeldItem()
		return item
	}
	const hands: (string | null)[] = []
	t.mock.method(bot, 'attack', (target: Entity) => {
		bot.attacks.push(target.id)
		hands.push(bot.heldItem?.name ?? null)
	})
	const advance = async (ms: number) => {
		for (let elapsed = 0; elapsed < ms; elapsed += 50) {
			t.mock.timers.tick(50)
			await flush()
			harness.step()
			await flush()
		}
	}
	const contents = () =>
		bot.inventory.slots.flatMap(item => (item ? [item.name] : [])).sort()
	return { ...harness, put, hands, packets, advance, contents }
}

test('an unarmed bot preemptively approaches and actually hits a hostile with a free hand', async t => {
	const { bot, actor, enemy, observe, advance, hands } = fixture(t)
	enemy.position.x = 5
	observe()
	await flush()
	await advance(2500)
	assert.ok(
		bot.entity.position.x > 2,
		'real physics advances the melee approach'
	)
	assert.ok(bot.attacks.includes(enemy.id))
	assert.ok(hands.length > 0 && hands.every(hand => hand === null))
	assert.equal(actor.getSnapshot().context.lastDamage.sequence, 0)
	assert.ok(
		actor
			.getSnapshot()
			.matches({ MAIN_ACTIVITY: { COMBAT: 'MELEE_ATTACKING' } })
	)
})

for (const fullHotbar of [false, true]) {
	test(`fists free a hand without losing held items (${fullHotbar ? 'full' : 'partial'} hotbar)`, async t => {
		const { bot, observe, put, advance, hands, contents, packets } = fixture(t)
		put(36, 'bread')
		if (fullHotbar) for (let slot = 37; slot < 45; slot++) put(slot, 'stone')
		const before = contents()
		observe()
		await flush()
		await advance(1500)
		assert.ok(hands.length > 0 && hands.every(hand => hand === null))
		assert.equal(bot.heldItem, null)
		assert.equal(bot.inventory.selectedItem, null)
		assert.deepEqual(contents(), before)
		assert.equal(
			packets.some(
				packet =>
					packet.name === 'block_dig' && [3, 4].includes(packet.status ?? -1)
			),
			false
		)
		assert.ok(
			packets
				.filter(packet => packet.name === 'window_click')
				.every(packet => packet.mode === 2)
		)
	})
}

for (const ranged of ['bow', 'crossbow']) {
	for (const melee of [null, 'iron_sword', 'iron_axe']) {
		test(`${ranged} without ammo uses ${melee ?? 'fists'} for close defense`, async t => {
			const { bot, observe, put, advance, hands } = fixture(t)
			put(36, ranged)
			if (melee) put(9, melee)
			observe()
			await flush()
			await advance(1500)
			assert.ok(hands.length > 0)
			assert.ok(hands.every(hand => hand === melee))
			assert.equal(bot.heldItem?.name ?? null, melee)
		})
	}
}

test('an available loaded ranged weapon is not bypassed with fists at close range', async t => {
	const { actor, observe, put, advance, hands } = fixture(t)
	put(36, 'bow')
	put(37, 'arrow')
	observe()
	await advance(1500)
	assert.deepEqual(hands, [])
	assert.ok(
		actor.getSnapshot().matches({ MAIN_ACTIVITY: { COMBAT: 'WAITING' } })
	)
})

test('weapon preparation never falls back to fists while native equip is delayed', async t => {
	const { bot, observe, put, advance, hands } = fixture(t)
	put(9, 'iron_sword')
	Object.assign(bot, { lastDigTime: Date.now() })
	observe()
	await flush()
	assert.equal(bot.heldItem, null)
	await advance(250)
	assert.deepEqual(hands, [])
	await advance(1500)
	assert.ok(hands.length > 0 && hands.every(hand => hand === 'iron_sword'))
})

test('losing the last sword continues defense with actual fists and a spare prevents that fallback', async t => {
	const { bot, observe, put, advance, hands } = fixture(t)
	put(36, 'iron_sword')
	observe()
	await flush()
	await advance(1000)
	assert.ok(hands.includes('iron_sword'))
	bot.inventory.slots[36] = null
	bot.asBot().updateHeldItem()
	await advance(1500)
	assert.ok(hands.includes(null))
	const before = hands.length
	put(9, 'stone_sword')
	Object.assign(bot, { lastDigTime: Date.now() })
	bot.emit('physicsTick')
	await flush()
	await advance(250)
	assert.equal(hands.length, before)
	await advance(1500)
	assert.ok(hands.length > before)
	assert.ok(hands.slice(before).every(hand => hand === 'stone_sword'))
})

for (const operation of ['equip', 'free-hand']) {
	test(`critical interruption cancels delayed native ${operation} without changing a new owner's hand`, async t => {
		const { bot, actor, enemy, observe, put, advance, hands, packets } =
			fixture(t)
		if (operation === 'equip') put(9, 'iron_sword')
		else for (let slot = 36; slot < 45; slot++) put(slot, 'stone')
		Object.assign(bot, { lastDigTime: Date.now() })
		observe()
		await flush()
		assert.deepEqual(hands, [])
		actor.send({ type: 'UPDATE_HEALTH', health: 8 })
		await flush()
		put(38, 'bow')
		bot.asBot().setQuickBarSlot(2)
		await advance(1500)
		assert.deepEqual(hands, [])
		assert.equal(bot.heldItem?.name, 'bow')
		assert.equal(
			packets.some(packet => packet.name === 'window_click'),
			false
		)
		assert.ok(
			bot.entity.position.distanceTo(enemy.position) > 4,
			'new survival owner actually escapes'
		)
		await bot
			.asBot()
			.equip(put(10, 'iron_axe'), 'hand', {
				signal: new AbortController().signal
			})
		assert.equal(
			bot.heldItem?.name,
			'iron_axe',
			'native inventory remains usable by a new owner'
		)
	})
}

test('a completely full inventory waits safely and resumes when storage becomes available', async t => {
	const { bot, actor, observe, put, advance, hands, contents, packets } =
		fixture(t)
	for (let slot = 9; slot < 45; slot++) put(slot, 'stone')
	const before = contents()
	observe()
	await flush()
	await advance(1500)
	assert.ok(
		actor.getSnapshot().matches({ MAIN_ACTIVITY: { COMBAT: 'WAITING' } })
	)
	assert.deepEqual(hands, [])
	assert.deepEqual(contents(), before)
	assert.equal(bot.inventory.selectedItem, null)
	assert.equal(
		packets.some(packet => packet.name === 'window_click'),
		false
	)
	assert.equal(
		packets.some(
			packet =>
				packet.name === 'block_dig' && [3, 4].includes(packet.status ?? -1)
		),
		false
	)
	bot.inventory.slots[9] = null
	await advance(1500)
	assert.ok(hands.length > 0 && hands.every(hand => hand === null))
	assert.ok(
		actor
			.getSnapshot()
			.matches({ MAIN_ACTIVITY: { COMBAT: 'MELEE_ATTACKING' } })
	)
})

for (const name of ['player', 'wither', 'ender_dragon', 'warden']) {
	test(`fists preserve ${name} exclusion even after confirmed damage`, async t => {
		const { actor, enemy, observe, advance, hands } = fixture(t)
		enemy.name = name
		if (name === 'player') enemy.type = 'player'
		observe()
		actor.send({
			type: 'DAMAGE_OBSERVED',
			sourceId: enemy.id,
			sourcePosition: enemy.position
		})
		observe()
		actor.send({ type: 'START_COMBAT', target: enemy })
		await advance(500)
		assert.deepEqual(hands, [])
		assert.equal(actor.getSnapshot().context.combatTarget.entity, null)
	})
}

test('unknown damage does not blame a nearby neutral mob when fists are available', async t => {
	const { actor, enemy, observe, advance, hands } = fixture(t)
	enemy.name = 'cow'
	observe()
	actor.send({ type: 'DAMAGE_OBSERVED', sourceId: null, sourcePosition: null })
	await advance(500)
	assert.deepEqual(hands, [])
	assert.equal(actor.getSnapshot().context.combatTarget.entity, null)
	assert.deepEqual(actor.getSnapshot().context.aggressionByEntity, {})
})

test('a dangerous creeper preempts fists with actual tactical movement', async t => {
	const { bot, actor, enemy, observe, advance, hands } = fixture(t)
	enemy.name = 'creeper'
	Object.assign(enemy.metadata, {
		[bot.registry.entitiesByName.creeper.metadataKeys.indexOf('state')]: 1,
		[bot.registry.entitiesByName.creeper.metadataKeys.indexOf('is_ignited')]:
			false
	})
	observe()
	await advance(1000)
	assert.deepEqual(hands, [])
	assert.ok(bot.entity.position.x < -1)
	assert.ok(
		actor.getSnapshot().matches({ MAIN_ACTIVITY: { COMBAT: 'RETREATING' } })
	)
})
