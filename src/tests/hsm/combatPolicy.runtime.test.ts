import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
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

const require = createRequire(import.meta.url)

test('a broken held sword stops attacks until the backup sword is equipped', async t => {
	t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] })
	const { bot, actor, observe } = createHarness()
	t.after(() => actor.stop())
	observe()
	await flush()
	bot.emit('physicTick')
	await flush()
	const before = bot.attacks.length
	const backup = new ItemFactory(registry.itemsByName.stone_sword.id, 1)
	backup.slot = 38
	bot.inventory.slots[36] = null
	bot.inventory.slots[38] = backup
	bot.inventory.items = () => [backup]
	let finishEquip = () => {}
	bot.equipGate = new Promise<void>(resolve => {
		finishEquip = resolve
	})
	for (let i = 0; i < 30; i++) {
		t.mock.timers.tick(50)
		bot.emit('physicsTick')
		bot.emit('physicTick')
		await flush()
	}
	assert.equal(
		bot.attacks.length,
		before,
		'no empty-hand attacks during rearming'
	)
	finishEquip()
	await flush()
	for (let i = 0; i < 30; i++) {
		t.mock.timers.tick(50)
		bot.emit('physicsTick')
		bot.emit('physicTick')
		await flush()
	}
	assert.equal(bot.heldItem?.name, 'stone_sword')
	assert.ok(bot.attacks.length > before, 'combat resumes with the backup')
})

test('a bowl and arrows are not a ranged loadout and do not conceal the missing-weapon notification', async t => {
	t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] })
	const { bot, actor, enemy, observe } = createHarness()
	t.after(() => actor.stop())
	loadHawkeye(bot.asBot())
	const bowl = new ItemFactory(registry.itemsByName.bowl.id, 1)
	bowl.slot = 36
	bot.inventory.items = () => [
		bowl,
		new ItemFactory(registry.itemsByName.arrow.id, 16)
	]
	enemy.position.x = 7
	for (let i = 0; i < 10; i++) {
		observe()
		t.mock.timers.tick(100)
		await flush()
		bot.emit('physicsTick')
	}
	assert.ok(actor.getSnapshot().matches({ MAIN_ACTIVITY: 'IDLE' }))
	assert.equal(bot.equippedItems.includes('bowl'), false)
	assert.equal(bot.itemUses, 0)
	assert.equal(
		bot.chatMessages.filter(message => /оружия нет/i.test(message)).length,
		1
	)
})

test('no weapon means no fight or retreat; notify once until rearmed, including explicit commands', async t => {
	t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] })
	const { bot, actor, enemy, observe, step } = createHarness()
	t.after(() => actor.stop())
	const armedInventory = bot.inventory.items
	bot.inventory.items = () => []
	for (let i = 0; i < 20; i++) {
		observe()
		actor.send({ type: 'START_COMBAT', target: enemy })
		t.mock.timers.tick(100)
		await flush()
		step()
		assert.ok(actor.getSnapshot().matches({ MAIN_ACTIVITY: 'IDLE' }))
	}
	assert.equal(bot.attacks.length, 0)
	assert.equal(bot.entity.position.x, 0)
	assert.equal(
		bot.chatMessages.filter(message => /оружия нет/i.test(message)).length,
		1
	)
	bot.inventory.items = armedInventory
	observe()
	await flush()
	t.mock.timers.tick(500)
	await flush()
	assert.equal(bot.pvp.target?.id, enemy.id)
	bot.inventory.items = () => []
	observe()
	t.mock.timers.tick(500)
	await flush()
	assert.ok(actor.getSnapshot().matches({ MAIN_ACTIVITY: 'IDLE' }))
	assert.equal(bot.pvp.target, undefined)
	assert.equal(
		bot.chatMessages.filter(message => /оружия нет/i.test(message)).length,
		2
	)
	actor.send({ type: 'UPDATE_HEALTH', health: 8 })
	for (let i = 0; i < 30; i++) {
		t.mock.timers.tick(50)
		await flush()
		step()
	}
	assert.ok(
		bot.entity.position.x < -2,
		'critical health still requires real escape without a weapon'
	)
})

test('nearest hostile replaces the previous target and a target gap does not start healthy flight', async t => {
	t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] })
	const { bot, actor, enemy } = createHarness(true)
	t.after(() => actor.stop())
	const second = createEntityFixture({
		...enemy,
		id: 2,
		position: new Vec3(4, 64, 0)
	})
	bot.entities = { 1: enemy, 2: second }
	await flush()
	for (let i = 0; i < 8; i++) {
		t.mock.timers.tick(100)
		await flush()
	}
	assert.equal(bot.pvp.target?.id, 1)
	second.position.x = 1
	for (let i = 0; i < 8; i++) {
		t.mock.timers.tick(100)
		await flush()
	}
	assert.equal(bot.pvp.target?.id, 2)
	delete bot.entities[2]
	bot.emit('entityGone', second)
	actor.send({ type: 'NO_ENEMIES' })
	for (let i = 0; i < 8; i++) {
		t.mock.timers.tick(100)
		await flush()
		assert.ok(
			!actor.getSnapshot().matches({ MAIN_ACTIVITY: { COMBAT: 'RETREATING' } })
		)
	}
	assert.equal(bot.pvp.target?.id, 1)
	assert.equal(actor.getSnapshot().context.health, 20)
})

for (const name of ['wither', 'ender_dragon', 'warden', 'unknown_mob']) {
	test(`${name}: neither attack nor flee at normal health, still escape at critical health`, async t => {
		t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] })
		const { bot, actor, enemy, observe, step } = createHarness()
		t.after(() => actor.stop())
		enemy.name = name
		observe()
		actor.send({
			type: 'DAMAGE_OBSERVED',
			sourceId: enemy.id,
			sourcePosition: enemy.position
		})
		// Boss exclusions also survive confirmed damage; unknown mobs can defend after damage.
		if (name !== 'unknown_mob') observe()
		for (let i = 0; i < 10; i++) {
			t.mock.timers.tick(100)
			await flush()
		}
		assert.ok(actor.getSnapshot().matches({ MAIN_ACTIVITY: 'IDLE' }))
		assert.equal(bot.attacks.length, 0)
		assert.equal(bot.controlState.forward, false)
		actor.send({ type: 'UPDATE_HEALTH', health: 8 })
		for (let i = 0; i < 30; i++) {
			t.mock.timers.tick(50)
			await flush()
			step()
		}
		assert.ok(bot.entity.position.x < -2)
	})
}

for (const version of ['1.20.1', '1.20.4', '1.20.6']) {
	test(`${version}: a protocol-spawned XP orb is never a threat or target`, async t => {
		t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] })
		const { bot, actor } = createHarness(true, version)
		t.after(() => actor.stop())
		require('mineflayer/lib/plugins/entities')(bot)
		t.mock.method(
			bot,
			'supportFeature',
			(feature: string) => feature === 'doublePosition'
		)
		bot._client.emit('spawn_entity_experience_orb', {
			entityId: 7,
			x: 1,
			y: 64,
			z: 0,
			count: 3
		})
		assert.equal(bot.entities[7]?.type, 'orb')
		await flush()
		for (let i = 0; i < 5; i++) {
			t.mock.timers.tick(100)
			await flush()
		}
		assert.equal(actor.getSnapshot().context.nearestThreat, null)
		assert.equal(actor.getSnapshot().context.combatTarget.entity, null)
		assert.ok(actor.getSnapshot().matches({ MAIN_ACTIVITY: 'IDLE' }))
	})
}
