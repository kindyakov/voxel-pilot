import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import test from 'node:test'
import { setImmediate as flush } from 'node:timers/promises'

import { Vec3 } from 'vec3'

import { loadHawkeye } from '@/modules/plugins/hawkeye.js'

import { isCoveredFrom } from '@/utils/combat/cover.js'
import { defensiveRelocationSafe } from '@/utils/combat/defensiveResponse.js'

import {
	ItemFactory,
	createEntityFixture,
	createHarness,
	registry
} from './fixtures/handoffBot.js'
import { testHarnessDependencies } from './fixtures/services.js'

const require = createRequire(import.meta.url)

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
		actor.getSnapshot().context.attackContacts[enemy.id]?.ranged,
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

test('unknown-source relocation resumes fresh planning only after actual departure and its separately configured quiet period', async t => {
	t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] })
	let turns = 0
	const { bot, actor, step } = createHarness(
		true,
		'1.20.4',
		testHarnessDependencies({
			runAgentTurn: async () => {
				turns++
				return await new Promise<never>(() => {})
			}
		}),
		{ preferences: { defensiveQuietMs: 5000 } }
	)
	t.after(() => actor.stop())
	for (let i = 0; i < 2; i++) {
		t.mock.timers.tick(100)
		await flush()
	}
	actor.send({ type: 'DAMAGE_OBSERVED', sourceId: null, sourcePosition: null })
	actor.send({ type: 'USER_COMMAND', username: 'owner', text: 'gather stone' })
	const started = Date.now()
	const budget = actor.getSnapshot().context.goalExecution
	const origin = bot.entity.position.clone()
	for (let i = 0; i < 98; i++) {
		t.mock.timers.tick(50)
		await flush()
		step()
	}
	assert.ok(
		bot.entity.position.distanceTo(origin) >= 14,
		'real escape actually leaves damaged location'
	)
	assert.ok(
		actor.getSnapshot().matches({ MAIN_ACTIVITY: 'DEFENSIVE_RELOCATION' })
	)
	assert.equal(turns, 0)
	assert.equal(Date.now() - started, 4900)
	for (let i = 0; i < 3; i++) {
		t.mock.timers.tick(50)
		await flush()
		step()
	}
	assert.ok(
		actor.getSnapshot().matches({ MAIN_ACTIVITY: { TASKS: 'THINKING' } })
	)
	assert.equal(turns, 1)
	assert.equal(actor.getSnapshot().context.goalExecution, budget)
})

test('trapped healthy protection preserves pause and retries only after a real passage opens', async t => {
	t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] })
	const { bot, actor, step } = createHarness(true)
	t.after(() => actor.stop())
	let open = false
	bot.solidAt = p =>
		p.y < 64 ||
		(p.y < 69 &&
			(Math.abs(Math.floor(p.x)) >= 2 || Math.abs(Math.floor(p.z)) >= 2) &&
			!(open && p.x < -1 && Math.abs(p.z) < 2))
	for (let i = 0; i < 2; i++) {
		t.mock.timers.tick(100)
		await flush()
	}
	actor.send({ type: 'DAMAGE_OBSERVED', sourceId: null, sourcePosition: null })
	for (let i = 0; i < 160; i++) {
		t.mock.timers.tick(50)
		await flush()
		step()
	}
	assert.equal(
		bot.chatMessages.filter(message => /выход|застрял/i.test(message)).length,
		1
	)
	assert.ok(
		actor.getSnapshot().matches({ MAIN_ACTIVITY: 'DEFENSIVE_RELOCATION' })
	)
	assert.ok(bot.entity.position.distanceTo(new Vec3(0, 64, 0)) < 2)
	open = true
	bot.emit('blockUpdate', null, bot.blockAt(new Vec3(-2, 64, 0)))
	for (let i = 0; i < 100; i++) {
		t.mock.timers.tick(50)
		await flush()
		step()
	}
	assert.ok(bot.entity.position.x < -10)
	assert.equal(bot.digCalls.length, 0)
	assert.equal(bot.placeCalls.length, 0)
})

test('healthy retreat can regain real ranged response while preserving the goal pause', async t => {
	t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] })
	const { bot, actor, enemy, step } = createHarness(true)
	t.after(() => actor.stop())
	loadHawkeye(bot.asBot())
	const bow = new ItemFactory(registry.itemsByName.bow.id, 1)
	bow.slot = 36
	bot.inventory.items = () => [
		bow,
		new ItemFactory(registry.itemsByName.arrow.id, 16)
	]
	enemy.name = 'skeleton'
	bot.entities = { 1: enemy }
	for (let i = 0; i < 4; i++) {
		t.mock.timers.tick(100)
		await flush()
	}
	actor.send({
		type: 'DAMAGE_OBSERVED',
		sourceId: enemy.id,
		sourcePosition: enemy.position,
		ranged: true
	})
	assert.ok(
		actor.getSnapshot().matches({ MAIN_ACTIVITY: 'DEFENSIVE_RELOCATION' })
	)
	for (let i = 0; i < 45; i++) {
		t.mock.timers.tick(50)
		await flush()
		step()
	}
	assert.ok(
		bot.entity.position.distanceTo(enemy.position) >
			actor.getSnapshot().context.preferences.enemyMeleeRange
	)
	assert.ok(
		actor
			.getSnapshot()
			.matches({ MAIN_ACTIVITY: { COMBAT: 'RANGED_SKIRMISHING' } })
	)
	assert.ok(bot.itemUses > 0, 'the native ranged controller starts its draw')
	assert.equal(bot.pvp.target, undefined)
	assert.ok(
		actor.getSnapshot().context.defensiveRelocation,
		'unresolved obligation remains until fresh safety after contact end'
	)
})

test('a protective actor failure retains its obligation and a new actor can actually relocate', async t => {
	t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] })
	const { bot, actor, step } = createHarness(true)
	t.after(() => actor.stop())
	for (let i = 0; i < 2; i++) {
		t.mock.timers.tick(100)
		await flush()
	}
	actor.send({ type: 'DAMAGE_OBSERVED', sourceId: null, sourcePosition: null })
	const obligation = actor.getSnapshot().context.defensiveRelocation
	actor.send({ type: 'ERROR', error: 'controller failed' })
	assert.ok(
		actor
			.getSnapshot()
			.matches({ MAIN_ACTIVITY: { DEFENSIVE_RELOCATION: 'RETRYING' } })
	)
	assert.equal(actor.getSnapshot().context.defensiveRelocation, obligation)
	for (let i = 0; i < 50; i++) {
		t.mock.timers.tick(50)
		await flush()
		step()
	}
	assert.ok(bot.entity.position.distanceTo(new Vec3(0, 64, 0)) > 4)
})

test('an aimed melee continuation cannot hit after healthy unknown-source protection takes ownership', async t => {
	t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] })
	const { bot, actor, enemy, step } = createHarness(true)
	t.after(() => actor.stop())
	let release!: () => void
	bot.aimGate = new Promise<void>(resolve => {
		release = resolve
	})
	bot.entities = { 1: enemy }
	for (let i = 0; i < 4; i++) {
		t.mock.timers.tick(100)
		await flush()
		step()
	}
	// The target's current position is now beyond any actual close response.
	enemy.position.x = 18
	actor.send({ type: 'DAMAGE_OBSERVED', sourceId: null, sourcePosition: null })
	assert.ok(
		actor.getSnapshot().matches({ MAIN_ACTIVITY: 'DEFENSIVE_RELOCATION' })
	)
	release()
	await flush()
	for (let i = 0; i < 40; i++) {
		t.mock.timers.tick(50)
		await flush()
		step()
	}
	assert.equal(bot.attacks.length, 0)
	assert.ok(
		bot.entity.position.x < -3,
		'new safety controller can move despite late old aim'
	)
})

test('confirmed shooter navigation behind a wall preserves the goal pause and permits hits only after actual LOS returns', async t => {
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
	enemy.position.x = 2.5
	bot.entities = { 1: enemy }
	let wall = true
	bot.solidAt = p =>
		p.y < 64 ||
		(wall && p.y < 68 && p.y >= 64 && p.x >= 1 && p.x < 2 && Math.abs(p.z) < 5)
	for (let i = 0; i < 4; i++) {
		t.mock.timers.tick(100)
		await flush()
	}
	actor.send({
		type: 'DAMAGE_OBSERVED',
		sourceId: enemy.id,
		sourcePosition: enemy.position,
		ranged: true
	})
	for (let i = 0; i < 2; i++) {
		t.mock.timers.tick(100)
		await flush()
		step()
	}
	actor.send({ type: 'USER_COMMAND', username: 'owner', text: 'gather stone' })
	for (let i = 0; i < 20; i++) {
		t.mock.timers.tick(50)
		await flush()
		step()
	}
	assert.equal(turns, 0)
	assert.equal(
		bot.attacks.length,
		0,
		'native PVP cannot strike through a wall despite being in attack radius'
	)
	assert.equal(actor.getSnapshot().context.combatTarget.entity?.id, enemy.id)
	wall = false
	bot.emit('blockUpdate', null, bot.blockAt(new Vec3(1, 64, 0)))
	for (let i = 0; i < 25; i++) {
		t.mock.timers.tick(50)
		await flush()
		step()
	}
	assert.ok(
		bot.attacks.includes(enemy.id),
		'new valid geometry permits an actual native hit'
	)
	assert.equal(turns, 0)
})

test('confirmed shooters keep nearest distance and stable identity ties within their priority class', async t => {
	t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] })
	const { bot, actor, enemy } = createHarness(true)
	t.after(() => actor.stop())
	const first = createEntityFixture({
		...enemy,
		id: 2,
		name: 'skeleton',
		position: new Vec3(18, 64, 0)
	})
	const second = createEntityFixture({
		...enemy,
		id: 3,
		name: 'skeleton',
		position: new Vec3(18, 64, 0)
	})
	bot.entities = { 1: enemy, 2: first, 3: second }
	for (let i = 0; i < 3; i++) {
		t.mock.timers.tick(100)
		await flush()
	}
	for (const source of [second, first])
		actor.send({
			type: 'DAMAGE_OBSERVED',
			sourceId: source.id,
			sourcePosition: source.position,
			ranged: true
		})
	for (let i = 0; i < 3; i++) {
		t.mock.timers.tick(100)
		await flush()
		bot.emit('physicsTick')
		await flush()
	}
	assert.equal(
		bot.pvp.target?.id,
		first.id,
		JSON.stringify({
			contacts: actor.getSnapshot().context.attackContacts,
			target: actor.getSnapshot().context.combatTarget,
			state: actor.getSnapshot().value
		})
	)
	second.position.x = 17
	for (let i = 0; i < 10; i++) {
		t.mock.timers.tick(100)
		await flush()
		bot.simulatePhysicsTick()
		await flush()
	}
	assert.equal(
		bot.pvp.target?.id,
		second.id,
		JSON.stringify({
			target: actor.getSnapshot().context.combatTarget,
			state: actor.getSnapshot().value,
			attempts: actor.getSnapshot().context.approachAttempts,
			damage: actor.getSnapshot().context.lastDamage,
			reason: actor.getSnapshot().context.lastReason
		})
	)
	assert.equal(actor.getSnapshot().context.nearestThreat?.entityId, enemy.id)
})

test('native modern damage packet promotes the distant projectile cause into the real HSM target exactly once', async t => {
	t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] })
	const { bot, actor, enemy } = createHarness(true)
	t.after(() => actor.stop())
	const shooter = createEntityFixture({
		...enemy,
		id: 7,
		name: 'skeleton',
		position: new Vec3(35, 64, 0)
	})
	const arrow = createEntityFixture({
		id: 8,
		name: 'arrow',
		type: 'projectile',
		position: new Vec3(0, 65, 0),
		isValid: true
	})
	require('mineflayer/lib/plugins/entities')(bot)
	Object.assign(bot.entities, { 1: enemy, 7: shooter, 8: arrow, [bot.entity.id]: bot.entity })
	for (let i = 0; i < 3; i++) {
		t.mock.timers.tick(100)
		await flush()
	}
	bot._client.emit('damage_event', {
		entityId: bot.entity.id,
		sourceTypeId: 0,
		sourceCauseId: shooter.id + 1,
		sourceDirectId: arrow.id + 1,
		sourcePosition: null
	})
	for (let i = 0; i < 3; i++) {
		t.mock.timers.tick(100)
		await flush()
		bot.emit('physicsTick')
		await flush()
	}
	assert.equal(actor.getSnapshot().context.lastDamage.sequence, 1)
	assert.equal(
		actor.getSnapshot().context.attackContacts[shooter.id]?.ranged,
		true
	)
	assert.equal(actor.getSnapshot().context.combatTarget.entity, shooter)
	assert.equal(bot.pvp.target?.id, shooter.id)
	assert.equal(actor.getSnapshot().context.nearestThreat?.entityId, enemy.id)
})

test('absence of walkable cover causes real distance fallback and fixed distance does not release continuing shooter danger', async t => {
	t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] })
	const { bot, actor, enemy, step } = createHarness(true)
	t.after(() => actor.stop())
	enemy.name = 'skeleton'
	enemy.position.x = 20
	bot.entities = { 1: enemy }
	for (let i = 0; i < 3; i++) {
		t.mock.timers.tick(100)
		await flush()
	}
	actor.send({
		type: 'DAMAGE_OBSERVED',
		sourceId: enemy.id,
		sourcePosition: enemy.position,
		ranged: true
	})
	t.mock.timers.tick(100)
	await flush()
	actor.send({ type: 'ERROR', error: 'controller rejected' })
	for (let i = 0; i < 160; i++) {
		t.mock.timers.tick(50)
		await flush()
		step()
	}
	assert.ok(bot.entity.position.distanceTo(enemy.position) > 35)
	assert.ok(
		actor.getSnapshot().matches({ MAIN_ACTIVITY: 'DEFENSIVE_RELOCATION' })
	)
	assert.equal(
		isCoveredFrom(bot.asBot(), bot.entity.position, enemy.position),
		false
	)
	assert.equal(bot.digCalls.length, 0)
	assert.equal(bot.placeCalls.length, 0)
})
