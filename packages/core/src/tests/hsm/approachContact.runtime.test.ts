import assert from 'node:assert/strict'
import test from 'node:test'
import { setImmediate as flush } from 'node:timers/promises'

import { Vec3 } from 'vec3'
import { fromPromise } from 'xstate'

import { canSeeEnemy } from '@/utils/combat/enemyVisibility.js'

import { createHarness } from './fixtures/handoffBot.js'
import { testHarnessDependencies } from './fixtures/services.js'

test('LOS loss and route exhaustion pause planning; missing position immediately stops movement until contact expires', async t => {
	t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] })
	let plans = 0
	const { bot, actor, enemy, observe } = createHarness(
		false,
		'1.20.4',
		undefined,
		{
			actors: {
				agentThinkingTurn: fromPromise(async () => {
					plans++
					return new Promise(() => {})
				})
			},
			preferences: { approachNoProgressMs: 500 }
		}
	)
	t.after(() => actor.stop())
	enemy.position = new Vec3(7, 64, 0)
	observe()
	actor.send({
		type: 'USER_COMMAND',
		username: 'owner',
		text: 'continue gathering stone'
	})
	const budget = actor.getSnapshot().context.goalExecution
	await flush()
	bot.solidAt = p => p.y < 64 || (Math.floor(p.x) === 2 && p.y < 68)
	for (let i = 0; i < 30; i++) {
		observe()
		t.mock.timers.tick(100)
		await flush()
	}
	assert.ok(
		actor.getSnapshot().matches({ MAIN_ACTIVITY: { COMBAT: 'WAITING' } })
	)
	assert.equal(plans, 0)
	assert.deepEqual(actor.getSnapshot().context.goalExecution, budget)
	assert.equal(bot.pvp.target, undefined)
	// Stale coordinates cannot restart navigation or a goal during bounded contact memory.
	observe()
	actor.send({
		type: 'UPDATE_ENTITIES',
		entities: [],
		enemies: [],
		players: []
	})
	actor.send({
		type: 'UPDATE_COMBAT_TARGET',
		combatTarget: { entity: null, distance: Infinity }
	})
	assert.ok(
		actor.getSnapshot().matches({ MAIN_ACTIVITY: { COMBAT: 'WAITING' } })
	)
	assert.equal(bot.pathfinder.goal, null)
	t.mock.timers.tick(1999)
	actor.send({
		type: 'UPDATE_ENTITIES',
		entities: [],
		enemies: [],
		players: []
	})
	actor.send({
		type: 'UPDATE_COMBAT_TARGET',
		combatTarget: { entity: null, distance: Infinity }
	})
	assert.equal(plans, 0)
	t.mock.timers.tick(1)
	actor.send({
		type: 'UPDATE_ENTITIES',
		entities: [],
		enemies: [],
		players: []
	})
	actor.send({
		type: 'UPDATE_COMBAT_TARGET',
		combatTarget: { entity: null, distance: Infinity }
	})
	await flush()
	assert.equal(plans, 1)
	assert.deepEqual(actor.getSnapshot().context.goalExecution, budget)
})

test('current target disappearing during active approach revokes native follow immediately', async t => {
	t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] })
	const { bot, actor, enemy, observe } = createHarness()
	const targetId = () => bot.pvp.target?.id
	t.after(() => actor.stop())
	enemy.position = new Vec3(7, 64, 0)
	observe()
	await flush()
	assert.ok(bot.pathfinder.goal)
	// Native despawn invalidates the old Entity object before notifying the harness.
	enemy.isValid = false
	actor.send({ type: 'REMOVE_ENTITY', entity: enemy })
	assert.equal(bot.pathfinder.goal, null)
	assert.equal(bot.pvp.target, undefined)
	assert.ok(
		actor.getSnapshot().matches({ MAIN_ACTIVITY: { COMBAT: 'WAITING' } })
	)
	enemy.isValid = true
	observe()
	await flush()
	assert.equal(targetId(), enemy.id)
})

test('a real wall detour advances away from the target longer than no-progress timeout and eventually hits only with LOS', async t => {
	t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] })
	const { bot, actor, enemy, observe, step } = createHarness()
	t.after(() => actor.stop())
	enemy.position = new Vec3(7, 64, 0)
	observe()
	await flush()
	// The target is continuously supplied behind a tall wall with a real side passage.
	bot.solidAt = p =>
		p.y < 64 ||
		(Math.floor(p.x) === 2 && p.y < 69 && Math.abs(Math.floor(p.z)) <= 12)
	const startDistance = bot.entity.position.distanceTo(enemy.position)
	let awayTicks = 0
	let largestDistance = startDistance
	bot.on('attackedTarget', () => {
		assert.ok(canSeeEnemy(bot.asBot(), enemy), 'native hit through wall')
		assert.ok(
			bot.entity.position.distanceTo(enemy.position) <= bot.pvp.attackRange
		)
	})
	for (let i = 0; i < 500 && bot.attacks.length === 0; i++) {
		t.mock.timers.tick(50)
		await flush()
		step()
		const distance = bot.entity.position.distanceTo(enemy.position)
		largestDistance = Math.max(largestDistance, distance)
		if (distance > startDistance) awayTicks++
		assert.equal(
			actor.getSnapshot().context.approachAttempts[enemy.id]?.blocked,
			false,
			`detour prematurely exhausted at ${i}: ${bot.entity.position}`
		)
	}
	assert.ok(awayTicks * 50 > 3000, `only ${awayTicks} ticks away`)
	assert.ok(largestDistance > startDistance + 4)
	assert.ok(
		bot.attacks.includes(enemy.id),
		`did not reach opponent: ${bot.entity.position}`
	)
	assert.equal(bot.digCalls.length, 0)
	assert.equal(bot.placeCalls.length, 0)
})

test('continuously observed confirmed shooter pursuit with real movement continues after 30 seconds without AI', async t => {
	t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] })
	const { bot, actor, enemy, step } = createHarness(
		true,
		'1.20.4',
		testHarnessDependencies({ aiPilotEnabled: false })
	)
	t.after(() => actor.stop())
	enemy.name = 'skeleton'
	enemy.position = new Vec3(35, 64, 0)
	bot.entities[enemy.id] = enemy
	actor.send({
		type: 'UPDATE_ENTITIES',
		entities: [enemy],
		enemies: [enemy],
		players: []
	})
	actor.send({
		type: 'DAMAGE_OBSERVED',
		sourceId: enemy.id,
		sourcePosition: enemy.position.clone(),
		ranged: true
	})
	actor.send({
		type: 'UPDATE_COMBAT_TARGET',
		combatTarget: { entity: enemy, distance: 35 }
	})
	await flush()
	const origin = bot.entity.position.clone()
	for (let i = 0; i < 650; i++) {
		enemy.position = bot.entity.position.offset(35, 0, 0)
		t.mock.timers.tick(50)
		await flush()
		step()
	}
	assert.ok(bot.entity.position.distanceTo(origin) > 50)
	assert.ok(
		actor
			.getSnapshot()
			.matches({ MAIN_ACTIVITY: { COMBAT: 'MELEE_ATTACKING' } })
	)
	assert.equal(
		actor.getSnapshot().context.approachAttempts[enemy.id]?.blocked,
		false
	)
	assert.equal(
		actor.getSnapshot().context.attackContacts[enemy.id]?.ranged,
		true
	)
	assert.equal(bot.attacks.length, 0)
})

test('route failure threshold is independent of no-progress time and controller failures stay blocked inside reach', async t => {
	t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] })
	const { bot, actor, enemy, observe } = createHarness(
		false,
		'1.20.4',
		undefined,
		{
			preferences: {
				approachRouteAttempts: 2,
				approachNoProgressMs: 10000,
				approachChangedConditionRetries: 0
			}
		}
	)
	t.after(() => actor.stop())
	enemy.position = new Vec3(7, 64, 0)
	observe()
	await flush()
	bot.emit('path_update', { status: 'noPath', path: [] })
	assert.equal(
		actor.getSnapshot().context.approachAttempts[enemy.id]?.failedRoutes,
		1
	)
	assert.equal(
		actor.getSnapshot().context.approachAttempts[enemy.id]?.blocked,
		false
	)
	bot.emit('path_update', { status: 'timeout', path: [] })
	assert.equal(
		actor.getSnapshot().context.approachAttempts[enemy.id]?.failedRoutes,
		2
	)
	assert.ok(
		actor.getSnapshot().matches({ MAIN_ACTIVITY: { COMBAT: 'WAITING' } })
	)
	bot.emit('path_update', { status: 'noPath', path: [] })
	assert.equal(
		actor.getSnapshot().context.approachAttempts[enemy.id]?.failedRoutes,
		2
	)
	enemy.position = new Vec3(3, 64, 0)
	observe()
	await flush()
	assert.equal(bot.pathfinder.goal, null)
	actor.send({ type: 'ERROR', error: 'PVP controller unavailable' })
	assert.equal(
		actor.getSnapshot().context.approachAttempts[enemy.id]?.blockedReason,
		'controller'
	)
	actor.send({ type: 'START_COMBAT', target: enemy })
	observe()
	await flush()
	assert.equal(bot.pvp.target, undefined)
	assert.ok(
		actor.getSnapshot().matches({ MAIN_ACTIVITY: { COMBAT: 'WAITING' } })
	)
})

test('confirmed circular server displacement cannot keep the native melee approach alive', async t => {
	t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] })
	const { bot, actor, enemy, observe } = createHarness()
	t.after(() => actor.stop())
	enemy.position = new Vec3(7, 64, 0)
	observe()
	await flush()
	for (let i = 1; i <= 100; i++) {
		// The Minecraft boundary confirms movement around the opponent, rather than
		// movement along PVP's accepted route. Controller intent is not progress.
		const angle = Math.PI + i * 0.04
		bot.entity.position = enemy.position.offset(
			7 * Math.cos(angle),
			0,
			7 * Math.sin(angle)
		)
		observe()
		t.mock.timers.tick(50)
		await flush()
		bot.emit('physicsTick')
	}
	assert.ok(
		actor.getSnapshot().matches({ MAIN_ACTIVITY: { COMBAT: 'WAITING' } })
	)
	assert.equal(
		actor.getSnapshot().context.approachAttempts[enemy.id]?.blocked,
		true
	)
	assert.equal(bot.pvp.target, undefined)
	assert.equal(bot.pathfinder.goal, null)
	assert.equal(bot.attacks.length, 0)
})

test('controller failure does not consume a retry merely because the enemy enters visible attack range', async t => {
	t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] })
	const { bot, actor, enemy, observe } = createHarness()
	t.after(() => actor.stop())
	enemy.position = new Vec3(7, 64, 0)
	observe()
	await flush()
	actor.send({ type: 'ERROR', error: 'controller refused operation' })
	enemy.position = new Vec3(3, 64, 0)
	observe()
	await flush()
	assert.ok(
		actor.getSnapshot().matches({ MAIN_ACTIVITY: { COMBAT: 'WAITING' } })
	)
	assert.equal(
		actor.getSnapshot().context.approachAttempts[enemy.id]?.resumes,
		0
	)
	assert.equal(
		actor.getSnapshot().context.approachAttempts[enemy.id]?.blockedReason,
		'controller'
	)
	assert.equal(bot.pvp.target, undefined)
	assert.equal(bot.pathfinder.goal, null)
})

test('rearming and repeated start preserve no-progress deadline at the exact configurable boundary', async t => {
	t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] })
	const { actor, enemy, observe } = createHarness(false, '1.20.4', undefined, {
		preferences: { approachNoProgressMs: 500 }
	})
	t.after(() => actor.stop())
	enemy.position = new Vec3(7, 64, 0)
	observe()
	await flush()
	const originalAnchor =
		actor.getSnapshot().context.approachAttempts[enemy.id]!.progress
	t.mock.timers.tick(400)
	actor.send({ type: 'WEAPON_BROKEN' })
	await flush()
	actor.send({ type: 'START_COMBAT', target: enemy })
	observe()
	t.mock.timers.tick(99)
	actor.send({ type: 'APPROACH_SAMPLE' })
	assert.deepEqual(
		actor.getSnapshot().context.approachAttempts[enemy.id]!.progress,
		originalAnchor
	)
	assert.equal(
		actor.getSnapshot().context.approachAttempts[enemy.id]!.blocked,
		false
	)
	t.mock.timers.tick(1)
	actor.send({ type: 'APPROACH_SAMPLE' })
	assert.equal(
		actor.getSnapshot().context.approachAttempts[enemy.id]!.blocked,
		true
	)
	t.mock.timers.tick(1)
	actor.send({ type: 'APPROACH_SAMPLE' })
	assert.deepEqual(
		actor.getSnapshot().context.approachAttempts[enemy.id]!.progress,
		originalAnchor
	)
	assert.ok(
		actor.getSnapshot().matches({ MAIN_ACTIVITY: { COMBAT: 'WAITING' } })
	)
})

test('continued confirmed fire escalates exhausted approach to healthy defensive movement without restarting the same attempt', async t => {
	t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] })
	const { bot, actor, enemy, observe, step } = createHarness(
		false,
		'1.20.4',
		undefined,
		{
			preferences: {
				approachNoProgressMs: 500,
				approachChangedConditionRetries: 0
			}
		}
	)
	t.after(() => actor.stop())
	enemy.name = 'skeleton'
	enemy.position = new Vec3(15, 64, 0)
	observe()
	actor.send({
		type: 'DAMAGE_OBSERVED',
		sourceId: enemy.id,
		sourcePosition: enemy.position.clone(),
		ranged: true
	})
	observe()
	await flush()
	t.mock.timers.tick(500)
	await flush()
	assert.ok(
		actor.getSnapshot().matches({ MAIN_ACTIVITY: 'DEFENSIVE_RELOCATION' })
	)
	assert.equal(bot.pvp.target, undefined)
	const origin = bot.entity.position.clone()
	for (let i = 0; i < 25; i++) {
		t.mock.timers.tick(50)
		await flush()
		step()
	}
	assert.ok(
		bot.entity.position.distanceTo(enemy.position) >
			origin.distanceTo(enemy.position) + 2
	)
	assert.equal(actor.getSnapshot().context.health, 20)
	assert.equal(
		actor.getSnapshot().context.approachAttempts[enemy.id]?.blocked,
		true
	)
	assert.equal(
		actor.getSnapshot().context.approachAttempts[enemy.id]?.resumes,
		0
	)
	assert.equal(bot.attacks.length, 0)
})

test('exhausted pursuit defends within reach without installing another chase, then waits again', async t => {
	t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] })
	const { bot, actor, enemy, observe, step } = createHarness(
		false,
		'1.20.4',
		undefined,
		{
			preferences: {
				approachNoProgressMs: 500,
				approachChangedConditionRetries: 0
			}
		}
	)
	t.after(() => actor.stop())
	enemy.position = new Vec3(7, 64, 0)
	observe()
	await flush()
	t.mock.timers.tick(500)
	await flush()
	assert.ok(
		actor.getSnapshot().matches({ MAIN_ACTIVITY: { COMBAT: 'WAITING' } })
	)
	enemy.position = new Vec3(3.4, 64, 0)
	observe()
	await flush()
	const origin = bot.entity.position.clone()
	for (let i = 0; i < 20; i++) {
		t.mock.timers.tick(50)
		await flush()
		step()
	}
	assert.ok(bot.attacks.includes(enemy.id))
	assert.equal(bot.pathfinder.goal, null)
	assert.ok(bot.entity.position.distanceTo(origin) < 0.01)
	assert.equal(
		actor.getSnapshot().context.approachAttempts[enemy.id]?.blocked,
		true
	)
	enemy.position = new Vec3(7, 64, 0)
	observe()
	assert.equal(bot.pvp.target, undefined)
	assert.ok(
		actor.getSnapshot().matches({ MAIN_ACTIVITY: { COMBAT: 'WAITING' } })
	)
})

test('cancellation during native route publication rejects the proposal and preserves the replacement movement owner', async t => {
	t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] })
	const { bot, actor, enemy, observe, step } = createHarness()
	t.after(() => actor.stop())
	enemy.position = new Vec3(7, 64, 0)
	observe()
	await flush()
	let cancelled = false
	bot.once('path_update', () => {
		cancelled = true
		actor.send({ type: 'UPDATE_HEALTH', health: 8 })
	})
	step()
	await flush()
	assert.ok(cancelled)
	assert.equal(bot.pvp.target, undefined)
	assert.ok(
		actor
			.getSnapshot()
			.matches({ MAIN_ACTIVITY: { URGENT_NEEDS: 'EMERGENCY_HEALING' } })
	)
	const origin = bot.entity.position.clone()
	for (let i = 0; i < 30; i++) {
		t.mock.timers.tick(50)
		await flush()
		step()
	}
	assert.equal(bot.attacks.length, 0)
	assert.ok(
		bot.entity.position.distanceTo(enemy.position) >
			origin.distanceTo(enemy.position) + 2
	)
	assert.equal(actor.getSnapshot().context.movementOwner, 'PATHFINDER')
})
