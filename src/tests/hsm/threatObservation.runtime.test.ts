import assert from 'node:assert/strict'
import test from 'node:test'
import { setImmediate as flush } from 'node:timers/promises'

import { Vec3 } from 'vec3'

import { createHarness } from './fixtures/handoffBot.js'

test('a player beside a briefly lost enemy is not a safe escape destination', async t => {
	t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] })
	const { bot, actor, enemy } = createHarness(true)
	t.after(() => actor.stop())
	const player = {
		...enemy,
		id: 2,
		name: 'Steve',
		type: 'player',
		position: new Vec3(3, 64, 0)
	} as typeof enemy
	bot.entities = { 1: enemy, 2: player }
	await flush()
	t.mock.timers.tick(100)
	await flush()
	actor.send({ type: 'UPDATE_HEALTH', health: 8 })
	await flush()
	t.mock.timers.tick(100)
	await flush()
	assert.equal(actor.getSnapshot().context.movementOwner, 'MOVEMENT')
	delete bot.entities[1]
	enemy.isValid = false
	for (let tick = 0; tick < 2; tick++) {
		t.mock.timers.tick(100)
		await flush()
	}
	assert.equal(actor.getSnapshot().context.nearestThreat?.entityId, enemy.id)
	assert.equal(
		actor.getSnapshot().context.movementOwner,
		'MOVEMENT',
		'Retained danger beside the player must rule out a route toward that player'
	)
	assert.equal(bot.pathfinder.goal, null)
})

test('safety observation includes threats beyond attack selection and follows live positions', async t => {
	t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] })
	const { bot, actor, enemy } = createHarness(true)
	t.after(() => actor.stop())
	enemy.position = new Vec3(35, 64, 0)
	bot.entities = { 1: enemy }
	await flush()
	t.mock.timers.tick(100)
	assert.equal(
		actor.getSnapshot().context.nearestThreat?.entityId,
		enemy.id,
		'Safety facts are available before asynchronous attack selection completes'
	)
	await flush()
	assert.equal(actor.getSnapshot().context.nearestThreat?.distance, 35)
	assert.equal(actor.getSnapshot().context.combatTarget.entity, null)
	assert.equal(bot.pvp.target, undefined)
	enemy.position = new Vec3(28, 64, 0)
	bot.entity.position = new Vec3(3, 64, 0)
	t.mock.timers.tick(100)
	await flush()
	assert.equal(actor.getSnapshot().context.nearestThreat?.distance, 25)
	assert.equal(actor.getSnapshot().context.combatTarget.entity, null)
})

test('an occluded unreachable enemy remains danger and cannot authorize safe eating', async t => {
	t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] })
	const { bot, actor, enemy } = createHarness(true)
	t.after(() => actor.stop())
	// A wall extending across the world prevents both line of sight and a route.
	bot.solidAt = position =>
		position.y < 64 || (Math.floor(position.x) === 1 && position.y < 70)
	bot.entities = { 1: enemy }
	await flush()
	t.mock.timers.tick(100)
	await flush()
	assert.equal(actor.getSnapshot().context.combatTarget.entity, null)
	assert.equal(actor.getSnapshot().context.nearestThreat?.entityId, enemy.id)
	actor.send({ type: 'UPDATE_HEALTH', health: 8 })
	await flush()
	t.mock.timers.tick(100)
	await flush()
	assert.equal(actor.getSnapshot().context.movementOwner, 'MOVEMENT')
	assert.equal(bot.itemUses, 0)
	assert.equal(bot.pvp.target, undefined)
	// Visibility briefly returns, then disappears; safety must not alternate with it.
	bot.solidAt = position => position.y < 64
	t.mock.timers.tick(100)
	await flush()
	bot.solidAt = position =>
		position.y < 64 || (Math.floor(position.x) === 1 && position.y < 70)
	t.mock.timers.tick(100)
	await flush()
	assert.equal(actor.getSnapshot().context.nearestThreat?.distance, 2)
	assert.equal(actor.getSnapshot().context.movementOwner, 'MOVEMENT')
})

test('brief entity loss preserves a bounded threat snapshot and updates its distance as the bot moves', async t => {
	t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] })
	const { bot, actor, enemy } = createHarness(true)
	t.after(() => actor.stop())
	bot.entities = { 1: enemy }
	await flush()
	t.mock.timers.tick(100)
	await flush()
	actor.send({ type: 'UPDATE_HEALTH', health: 8 })
	await flush()
	t.mock.timers.tick(100)
	await flush()
	assert.equal(actor.getSnapshot().context.movementOwner, 'MOVEMENT')
	delete bot.entities[1]
	enemy.isValid = false
	actor.send({ type: 'REMOVE_ENTITY', entity: enemy })
	// Lost entity references are mutable; retention must use its last observed position.
	enemy.position = new Vec3(999, 64, 0)
	bot.entity.position = new Vec3(-3, 64, 0)
	t.mock.timers.tick(100)
	await flush()
	assert.equal(actor.getSnapshot().context.nearestThreat?.distance, 5)
	assert.equal(actor.getSnapshot().context.movementOwner, 'MOVEMENT')
	for (let tick = 0; tick < 22; tick++) {
		t.mock.timers.tick(100)
		await flush()
	}
	assert.equal(
		actor.getSnapshot().context.nearestThreat,
		null,
		'Lost observations must expire rather than become permanent danger'
	)
	assert.equal(actor.getSnapshot().context.movementOwner, 'NONE')
})

test('survival reacts to a new close threat before the combat controller has retargeted', async t => {
	t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] })
	const { bot, actor, enemy, step } = createHarness(true)
	t.after(() => actor.stop())
	enemy.position = new Vec3(8, 64, 0)
	bot.entities = { 1: enemy }
	await flush()
	for (let tick = 0; tick < 7; tick++) {
		t.mock.timers.tick(100)
		await flush()
	}
	assert.equal(bot.pvp.target?.id, enemy.id)
	enemy.position = new Vec3(18, 64, 0)
	const close = {
		...enemy,
		id: 2,
		position: new Vec3(-2, 64, 0)
	} as typeof enemy
	bot.entities[2] = close
	t.mock.timers.tick(100)
	await flush()
	assert.equal(
		bot.pvp.target?.id,
		enemy.id,
		'The movement handoff cannot wait for the combat controller to retarget'
	)
	actor.send({ type: 'UPDATE_HEALTH', health: 8 })
	await flush()
	t.mock.timers.tick(100)
	await flush()
	assert.equal(
		actor.getSnapshot().context.movementOwner,
		'MOVEMENT',
		'Close danger requires immediate micro-movement, not a path toward a distant-target escape point'
	)
	for (let tick = 0; tick < 20; tick++) {
		step()
		t.mock.timers.tick(50)
		await flush()
	}
	assert.ok(
		bot.entity.position.x > 2,
		'Escape must move away from the close enemy at negative X'
	)
	assert.equal(bot.pvp.target, undefined)
})
