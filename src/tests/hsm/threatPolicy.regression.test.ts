import assert from 'node:assert/strict'
import test from 'node:test'
import { setImmediate as flush } from 'node:timers/promises'

import { Vec3 } from 'vec3'

import { createEntityFixture, createHarness } from './fixtures/handoffBot'

for (const otherSource of ['skeleton', 'unknown']) {
	test(`a daylight spider remains an aggressor after damage from ${otherSource}`, async t => {
		t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] })
		const { bot, actor, enemy, step } = createHarness(true)
		t.after(() => actor.stop())
		enemy.name = 'spider'
		const blockAt = bot.blockAt.bind(bot)
		bot.blockAt = position => {
			const block = blockAt(position)
			block.light = 0
			block.skyLight = 15
			return block
		}
		const skeleton = createEntityFixture({
			...enemy,
			id: 2,
			name: 'skeleton',
			position: new Vec3(35, 64, 0)
		})
		bot.entities = { 1: enemy, 2: skeleton }
		bot.emit('entityHurt', bot.entity, enemy)
		await flush()
		for (let tick = 0; tick < 20; tick++) {
			t.mock.timers.tick(50)
			await flush()
			step()
		}
		assert.ok(bot.attacks.includes(enemy.id))
		const attacks = bot.attacks.length
		bot.emit(
			'entityHurt',
			bot.entity,
			otherSource === 'skeleton' ? skeleton : undefined
		)
		for (let tick = 0; tick < 50; tick++) {
			t.mock.timers.tick(50)
			await flush()
			step()
		}
		assert.equal(actor.getSnapshot().context.nearestThreat?.entityId, enemy.id)
		assert.equal(actor.getSnapshot().context.combatTarget.entity?.id, enemy.id)
		assert.ok(bot.attacks.length > attacks, 'self-defense must continue')
	})
}

for (const [name, expectedKind] of [
	['magma_cube', 'hostile'],
	['hoglin', 'hostile'],
	['ghast', 'hostile'],
	['pufferfish', 'uncertain'],
	['wolf', 'uncertain']
] as const) {
	test(`a dangerous ${name} keeps a recovering bot at a distance`, async t => {
		t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] })
		const { bot, actor, enemy, step } = createHarness(true)
		t.after(() => actor.stop())
		enemy.name = name
		enemy.type = bot.registry.entitiesByName[name].type
		bot.entities = { 1: enemy }
		actor.send({ type: 'UPDATE_HEALTH', health: 8 })
		await flush()
		for (let tick = 0; tick < 30; tick++) {
			t.mock.timers.tick(50)
			await flush()
			step()
		}
		assert.equal(actor.getSnapshot().context.nearestThreat?.kind, expectedKind)
		assert.ok(bot.entity.position.x < -2, 'danger must cause real escape')
		assert.equal(bot.attacks.length, 0)
	})
}

for (const name of ['cow', 'villager', 'armor_stand', 'item']) {
	test(`a known harmless ${name} does not interrupt ordinary behavior`, async t => {
		t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] })
		const { bot, actor, enemy, step } = createHarness(true)
		t.after(() => actor.stop())
		enemy.name = name
		enemy.type = bot.registry.entitiesByName[name].type
		bot.entities = { 1: enemy }
		await flush()
		for (let tick = 0; tick < 20; tick++) {
			t.mock.timers.tick(50)
			await flush()
			step()
		}
		assert.equal(actor.getSnapshot().context.nearestThreat, null)
		assert.equal(bot.entity.position.x, 0)
		assert.equal(bot.attacks.length, 0)
	})
}
