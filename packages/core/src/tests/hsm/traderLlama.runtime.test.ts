import assert from 'node:assert/strict'
import test from 'node:test'
import { setImmediate as flush } from 'node:timers/promises'

import { Vec3 } from 'vec3'

import { loadAutoEat } from '@/modules/plugins/autoEat.js'

import {
	ItemFactory,
	createEntityFixture,
	createHarness,
	registry
} from './fixtures/handoffBot.js'

for (const name of ['llama', 'trader_llama']) {
	test(`an unprovoked ${name} does not trigger retreat or combat`, async t => {
		t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] })
		const { bot, actor, enemy, step } = createHarness(true, '1.20.6')
		t.after(() => actor.stop())
		enemy.name = name
		enemy.type = bot.registry.entitiesByName[name].type
		bot.entities = { [enemy.id]: enemy }
		const initialPosition = bot.entity.position.clone()
		await flush()
		for (let tick = 0; tick < 20; tick++) {
			t.mock.timers.tick(50)
			await flush()
			step()
		}
		assert.equal(actor.getSnapshot().context.nearestThreat, null)
		assert.ok(actor.getSnapshot().matches({ MAIN_ACTIVITY: 'IDLE' }))
		assert.equal(bot.entity.position.distanceTo(initialPosition), 0)
		assert.equal(bot.attacks.length, 0)
	})

	for (const health of [20, 8]) {
		test(`${name}: confirmed damage permits defense, but health ${health} preserves survival priority`, async t => {
			t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] })
			const { bot, actor, enemy, step } = createHarness(true, '1.20.6')
			t.after(() => actor.stop())
			enemy.name = name
			enemy.type = bot.registry.entitiesByName[name].type
			bot.entities = { [enemy.id]: enemy }
			actor.send({ type: 'UPDATE_HEALTH', health })
			bot.emit('entityHurt', bot.entity, enemy)
			await flush()
			for (let tick = 0; tick < 30; tick++) {
				t.mock.timers.tick(50)
				await flush()
				step()
			}
			assert.equal(actor.getSnapshot().context.nearestThreat?.kind, 'hostile')
			if (health === 20) assert.ok(bot.attacks.includes(enemy.id))
			else {
				assert.equal(bot.attacks.length, 0)
				assert.ok(
					bot.entity.position.x < -2,
					'must physically escape the attacking llama'
				)
			}
		})
	}
}

test('a wandering trader with two llamas does not cause flight from a distant skeleton', async t => {
	t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] })
	const { bot, actor, step } = createHarness(true, '1.20.6')
	t.after(() => actor.stop())
	const names = ['wandering_trader', 'trader_llama', 'trader_llama', 'skeleton']
	const entities = names.map((name, index) =>
		createEntityFixture({
			id: index + 1,
			name,
			type: bot.registry.entitiesByName[name].type,
			position: new Vec3(index === 3 ? 38 : 1.7 + index * 0.1, 64, 0),
			isValid: true
		})
	)
	bot.entities = Object.fromEntries(entities.map(entity => [entity.id, entity]))
	const initialPosition = bot.entity.position.clone()
	await flush()
	for (let tick = 0; tick < 40; tick++) {
		t.mock.timers.tick(50)
		await flush()
		step()
	}
	assert.deepEqual(
		actor.getSnapshot().context.threats.map(threat => threat.entityId),
		[4]
	)
	assert.ok(actor.getSnapshot().matches({ MAIN_ACTIVITY: 'IDLE' }))
	assert.equal(bot.entity.position.distanceTo(initialPosition), 0)
	assert.equal(bot.attacks.length, 0)
})

test('a passive llama does not block eating, but a zombie behind it interrupts recovery immediately', async t => {
	t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] })
	const { bot, actor, enemy, step } = createHarness(true)
	t.after(() => actor.stop())
	loadAutoEat(bot.asBot())
	const bread = new ItemFactory(registry.itemsByName.bread.id, 16)
	bread.slot = 9
	bot.inventory.items = () => [bread]
	bot.food = 8
	enemy.name = 'trader_llama'
	enemy.type = bot.registry.entitiesByName.trader_llama.type
	bot.entities = { [enemy.id]: enemy }
	actor.send({ type: 'UPDATE_FOOD', food: 8 })
	actor.send({ type: 'UPDATE_HEALTH', health: 8 })
	await flush()
	for (let tick = 0; tick < 10; tick++) {
		t.mock.timers.tick(50)
		await flush()
		step()
	}
	assert.equal(actor.getSnapshot().context.nearestThreat, null)
	assert.equal(bot.usingItem, true)
	assert.equal(bot.entity.position.x, 0)
	const zombie = createEntityFixture({
		id: 2,
		name: 'zombie',
		type: 'hostile',
		position: new Vec3(5, 64, 0),
		isValid: true
	})
	bot.entities[zombie.id] = zombie
	for (let tick = 0; tick < 30; tick++) {
		t.mock.timers.tick(50)
		await flush()
		step()
	}
	assert.equal(actor.getSnapshot().context.nearestThreat?.entityId, zombie.id)
	assert.equal(bot.usingItem, false)
	assert.equal(bot.attacks.length, 0)
	assert.ok(bot.entity.position.x < -2)
})

for (const update of ['safe_variant', 'disappeared']) {
	test(`an uncertain rabbit becoming ${update} distinguishes safety evidence from lost visibility`, async t => {
		t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] })
		const { bot, actor, enemy, step } = createHarness(true, '1.20.6')
		t.after(() => actor.stop())
		enemy.name = 'rabbit'
		enemy.type = bot.registry.entitiesByName.rabbit.type
		bot.entities = { [enemy.id]: enemy }
		await flush()
		t.mock.timers.tick(100)
		await flush()
		assert.equal(actor.getSnapshot().context.nearestThreat?.kind, 'uncertain')
		if (update === 'safe_variant')
			Object.assign(enemy.metadata, {
				[bot.registry.entitiesByName.rabbit.metadataKeys.indexOf('type')]: 0
			})
		else bot.entities = {}
		for (let tick = 0; tick < 4; tick++) {
			t.mock.timers.tick(50)
			await flush()
			step()
		}
		if (update === 'safe_variant') {
			assert.equal(actor.getSnapshot().context.nearestThreat, null)
			assert.ok(actor.getSnapshot().matches({ MAIN_ACTIVITY: 'IDLE' }))
			assert.equal(actor.getSnapshot().context.movementOwner, 'NONE')
		} else {
			assert.equal(actor.getSnapshot().context.nearestThreat?.kind, 'uncertain')
			assert.equal(actor.getSnapshot().context.nearestThreat?.observed, false)
			for (let tick = 0; tick < 40; tick++) {
				t.mock.timers.tick(50)
				await flush()
				step()
			}
			assert.equal(actor.getSnapshot().context.nearestThreat, null)
		}
	})
}
