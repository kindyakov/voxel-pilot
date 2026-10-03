import assert from 'node:assert/strict'
import test from 'node:test'
import { setImmediate as flush } from 'node:timers/promises'

import { Vec3 } from 'vec3'

import { isCoveredFrom } from '@/utils/combat/cover.js'
import { defensiveRelocationSafe } from '@/utils/combat/defensiveResponse.js'

import {
	ItemFactory,
	createEntityFixture,
	createHarness,
	registry
} from './fixtures/handoffBot.js'
import { testHarnessDependencies } from './fixtures/services.js'

test('confirmed shooter replaces nearest melee mob and admits extended real melee approach without AI', async t => {
	t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] })
	const { bot, actor, enemy, step } = createHarness(
		true,
		'1.20.4',
		testHarnessDependencies({ aiPilotEnabled: false })
	)
	t.after(() => actor.stop())
	const shooter = createEntityFixture({
		id: 2,
		name: 'skeleton',
		type: 'hostile',
		height: 1.8,
		position: new Vec3(35, 64, 0),
		isValid: true
	})
	bot.entities = { 1: enemy, 2: shooter }
	for (let tick = 0; tick < 4; tick++) {
		t.mock.timers.tick(100)
		await flush()
	}
	assert.equal(actor.getSnapshot().context.combatTarget.entity?.id, enemy.id)
	actor.send({
		type: 'DAMAGE_OBSERVED',
		sourceId: shooter.id,
		sourcePosition: shooter.position,
		ranged: true
	})
	const origin = bot.entity.position.clone()
	for (let tick = 0; tick < 30; tick++) {
		t.mock.timers.tick(50)
		await flush()
		step()
	}
	assert.equal(actor.getSnapshot().context.combatTarget.entity?.id, shooter.id)
	assert.equal(actor.getSnapshot().context.nearestThreat?.entityId, enemy.id)
	assert.ok(
		bot.entity.position.x > origin.x + 1,
		'native pursuit must actually move toward the distant attacker'
	)
	assert.equal(bot.pvp.target?.id, shooter.id)
	assert.equal(bot.digCalls.length, 0)
	assert.equal(bot.placeCalls.length, 0)
})

test('confirmed shooter contact persists beyond aggression retention and thirty seconds without a total deadline', async t => {
	t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] })
	const { bot, actor, enemy } = createHarness(true)
	t.after(() => actor.stop())
	enemy.name = 'skeleton'
	enemy.position.x = 40
	bot.entities = { 1: enemy }
	for (let tick = 0; tick < 2; tick++) {
		t.mock.timers.tick(100)
		await flush()
	}
	actor.send({
		type: 'DAMAGE_OBSERVED',
		sourceId: enemy.id,
		sourcePosition: enemy.position,
		ranged: true
	})
	// Real displacement with continued closing progress; no fake actor events.
	for (let tick = 0; tick < 320; tick++) {
		bot.entity.position.x += 0.09
		t.mock.timers.tick(100)
		await flush()
		bot.emit('physicsTick')
	}
	assert.ok(
		actor
			.getSnapshot()
			.matches({ MAIN_ACTIVITY: { COMBAT: 'MELEE_ATTACKING' } })
	)
	assert.equal(actor.getSnapshot().context.combatTarget.entity?.id, enemy.id)
	assert.equal(
		actor.getSnapshot().context.attackContacts[enemy.id].ranged,
		true
	)
})

test('unknown source in already available close melee preserves combat; distant unknown damage relocates', async t => {
	t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] })
	const { bot, actor, enemy, step } = createHarness(true)
	t.after(() => actor.stop())
	bot.entities = { 1: enemy }
	for (let tick = 0; tick < 4; tick++) {
		t.mock.timers.tick(100)
		await flush()
	}
	actor.send({ type: 'DAMAGE_OBSERVED', sourceId: null, sourcePosition: null })
	assert.ok(
		actor
			.getSnapshot()
			.matches({ MAIN_ACTIVITY: { COMBAT: 'MELEE_ATTACKING' } })
	)
	assert.equal(actor.getSnapshot().context.defensiveRelocation, null)
	bot.entities = {}
	enemy.isValid = false
	for (let tick = 0; tick < 30; tick++) {
		t.mock.timers.tick(100)
		await flush()
	}
	actor.send({ type: 'DAMAGE_OBSERVED', sourceId: null, sourcePosition: null })
	const origin = bot.entity.position.clone()
	for (let tick = 0; tick < 60; tick++) {
		t.mock.timers.tick(50)
		await flush()
		step()
	}
	assert.ok(bot.entity.position.distanceTo(origin) > 3)
	assert.equal(
		Object.keys(actor.getSnapshot().context.attackContacts).length,
		0,
		'unknown damage never attributes the nearest entity'
	)
})

test('excluded boss hit causes healthy protective movement and cannot become a combat target', async t => {
	t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] })
	const { bot, actor, enemy, step } = createHarness(true)
	t.after(() => actor.stop())
	enemy.name = 'warden'
	enemy.position.x = 10
	bot.entities = { 1: enemy }
	for (let tick = 0; tick < 4; tick++) {
		t.mock.timers.tick(100)
		await flush()
	}
	bot.emit('entityHurt', bot.entity, enemy)
	for (let tick = 0; tick < 50; tick++) {
		t.mock.timers.tick(50)
		await flush()
		step()
	}
	assert.ok(
		actor.getSnapshot().matches({ MAIN_ACTIVITY: 'DEFENSIVE_RELOCATION' })
	)
	assert.equal(bot.attacks.length, 0)
	assert.ok(bot.entity.position.distanceTo(enemy.position) > 12)
})

test('unknown damage return requires actual departure, quiet boundary and fresh safe observations', async t => {
	t.mock.timers.enable({ apis: ['Date'] })
	const { bot, actor } = createHarness()
	t.after(() => actor.stop())
	actor.send({
		type: 'UPDATE_ENTITIES',
		entities: [],
		enemies: [],
		players: []
	})
	actor.send({ type: 'DAMAGE_OBSERVED', sourceId: null, sourcePosition: null })
	assert.equal(defensiveRelocationSafe(actor.getSnapshot().context), false)
	t.mock.timers.tick(2001)
	actor.send({
		type: 'UPDATE_ENTITIES',
		entities: [],
		enemies: [],
		players: []
	})
	assert.equal(
		defensiveRelocationSafe(actor.getSnapshot().context),
		false,
		'quiet timer cannot substitute departure'
	)
	bot.entity.position.z = -15
	actor.send({ type: 'DAMAGE_OBSERVED', sourceId: null, sourcePosition: null })
	bot.entity.position.z = -30
	t.mock.timers.tick(1999)
	actor.send({
		type: 'UPDATE_ENTITIES',
		entities: [],
		enemies: [],
		players: []
	})
	assert.equal(defensiveRelocationSafe(actor.getSnapshot().context), false)
	t.mock.timers.tick(1)
	actor.send({
		type: 'UPDATE_ENTITIES',
		entities: [],
		enemies: [],
		players: []
	})
	assert.equal(defensiveRelocationSafe(actor.getSnapshot().context), true)
	actor.send({ type: 'THREAT_OBSERVATION_INVALID', reason: 'observer_failed' })
	assert.equal(defensiveRelocationSafe(actor.getSnapshot().context), false)
})

test('loaded ranged-only hand at close range cannot suppress unknown-source protection', async t => {
	t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] })
	const { bot, actor, enemy } = createHarness(true)
	t.after(() => actor.stop())
	bot.inventory.items = () => [
		new ItemFactory(registry.itemsByName.bow.id, 1),
		new ItemFactory(registry.itemsByName.arrow.id, 5)
	]
	bot.entities = { 1: enemy }
	for (let tick = 0; tick < 4; tick++) {
		t.mock.timers.tick(100)
		await flush()
	}
	actor.send({ type: 'DAMAGE_OBSERVED', sourceId: null, sourcePosition: null })
	assert.ok(
		actor.getSnapshot().matches({ MAIN_ACTIVITY: 'DEFENSIVE_RELOCATION' })
	)
})

test('unloaded confirmed shooter cannot be masked by a nearer available zombie', async t => {
	t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] })
	const { bot, actor, enemy } = createHarness(true)
	t.after(() => actor.stop())
	bot.entities = { 1: enemy }
	for (let tick = 0; tick < 4; tick++) {
		t.mock.timers.tick(100)
		await flush()
	}
	actor.send({
		type: 'DAMAGE_OBSERVED',
		sourceId: 37,
		sourcePosition: new Vec3(25, 64, 0),
		ranged: true
	})
	assert.ok(
		actor.getSnapshot().matches({ MAIN_ACTIVITY: 'DEFENSIVE_RELOCATION' })
	)
	assert.equal(actor.getSnapshot().context.nearestThreat?.entityId, enemy.id)
})

test('walkable cover is preferred and actual LOS breaks while the dangerous shooter still holds the goal pause', async t => {
	t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] })
	let turns = 0
	const { bot, actor, enemy, step } = createHarness(
		true,
		'1.20.4',
		testHarnessDependencies({
			runAgentTurn: async () => {
				turns++
				return await new Promise<never>(() => {})
			}
		})
	)
	t.after(() => actor.stop())
	enemy.name = 'skeleton'
	enemy.position = new Vec3(20, 64, 0)
	bot.entities = { 1: enemy }
	// The nearby wall provides lateral walkable cover, no world mutation.
	bot.solidAt = position =>
		position.y < 64 ||
		(position.y < 68 &&
			position.y >= 64 &&
			position.x >= 2 &&
			position.x < 3 &&
			position.z >= 2 &&
			position.z < 10)
	for (let tick = 0; tick < 4; tick++) {
		t.mock.timers.tick(100)
		await flush()
	}
	// No usable attack controller -> defensive relocation. This represents a rejected native controller.
	actor.send({
		type: 'DAMAGE_OBSERVED',
		sourceId: enemy.id,
		sourcePosition: enemy.position,
		ranged: true
	})
	t.mock.timers.tick(100)
	await flush()
	actor.send({ type: 'ERROR', error: 'controller rejected' })
	actor.send({ type: 'USER_COMMAND', username: 'owner', text: 'gather stone' })
	for (let tick = 0; tick < 200; tick++) {
		t.mock.timers.tick(50)
		await flush()
		step()
	}
	assert.ok(
		isCoveredFrom(bot.asBot(), bot.entity.position, enemy.position),
		`real pathfinder physics reaches occluded cover: ${JSON.stringify({ position: bot.entity.position, state: actor.getSnapshot().value, goal: bot.pathfinder.goal, messages: bot.chatMessages })}`
	)
	assert.ok(
		bot.entity.position.distanceTo(new Vec3(0, 64, 0)) < 15,
		'nearby cover is selected ahead of the open distant escape circle'
	)
	assert.ok(
		actor.getSnapshot().matches({ MAIN_ACTIVITY: 'DEFENSIVE_RELOCATION' })
	)
	assert.equal(turns, 0)
	assert.equal(bot.digCalls.length, 0)
	assert.equal(bot.placeCalls.length, 0)
	const budget = actor.getSnapshot().context.goalExecution
	actor.send({ type: 'ENTITY_DIED', entity: enemy })
	bot.entities = {}
	enemy.isValid = false
	for (let tick = 0; tick < 6; tick++) {
		t.mock.timers.tick(100)
		await flush()
		step()
	}
	assert.ok(
		actor.getSnapshot().matches({ MAIN_ACTIVITY: { TASKS: 'THINKING' } })
	)
	assert.equal(turns, 1, 'contact death permits fresh planning after cover')
	assert.equal(actor.getSnapshot().context.goalExecution, budget)
})
