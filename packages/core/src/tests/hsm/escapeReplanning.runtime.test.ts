import assert from 'node:assert/strict'
import test from 'node:test'
import { setImmediate as flush } from 'node:timers/promises'

import { Vec3 } from 'vec3'

import type { ThreatObservation } from '@/hsm/context.js'

import { EscapeRuntime } from '@/utils/combat/escapeRuntime.js'
import { EscapeSafety } from '@/utils/combat/escapeSafety.js'

import { createEntityFixture, createHarness } from './fixtures/handoffBot.js'

const threat = (entityId: number, x: number, z: number): ThreatObservation => ({
	entityId,
	kind: 'hostile',
	position: new Vec3(x, 64, z),
	distance: Math.hypot(x, z),
	lastObservedAt: Date.now(),
	observed: true,
	creeper: null
})

test('real escape keeps moving on its route while distant mobs move', async t => {
	t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] })
	const { bot, actor, enemy, step } = createHarness(true, '1.20.6')
	t.after(() => actor.stop())
	enemy.position = new Vec3(18, 64, 0)
	const distant = createEntityFixture({
		...enemy,
		id: 2,
		position: new Vec3(0, 64, 45)
	})
	bot.entities = { 1: enemy, 2: distant }
	actor.send({ type: 'UPDATE_HEALTH', health: 8 })
	await flush()
	for (let i = 0; i < 4; i++) {
		t.mock.timers.tick(50)
		await flush()
		step()
	}
	const goal = bot.pathfinder.goal
	assert.ok(goal)
	const before = bot.entity.position.clone()
	for (let i = 0; i < 16; i++) {
		distant.position.z = i % 2 === 0 ? 45 : 49
		t.mock.timers.tick(50)
		await flush()
		step()
		assert.equal(bot.pathfinder.goal, goal, 'keep the same route')
	}
	assert.ok(
		bot.entity.position.x < before.x - 2,
		'actual displacement, not just an active goal'
	)
	assert.equal(bot.attacks.length, 0)
})

test('an active safe route survives distant threat movement, arrival and removal', t => {
	const { bot, actor } = createHarness(false, '1.20.6')
	const preferences = actor.getSnapshot().context.preferences
	const escape = new EscapeRuntime(bot.asBot(), preferences)
	t.after(() => {
		escape.stop()
		actor.stop()
	})
	const origin = bot.entity.position.clone()
	const nearby = threat(1, 18, 0)
	const paths: Array<Array<{ x: number; y: number; z: number }>> = []
	const getPath = bot.pathfinder.getPathFromTo.bind(bot.pathfinder)
	t.mock.method(
		bot.pathfinder,
		'getPathFromTo',
		function* (...args: Parameters<typeof getPath>) {
			for (const value of getPath(...args)) {
				if (value.result.status === 'success') paths.push(value.result.path)
				yield value
			}
		}
	)
	const setGoal = t.mock.method(bot.pathfinder, 'setGoal')
	escape.move(nearby, [nearby, threat(2, 0, 45)], null)
	assert.equal(paths.length, 1)
	const path = paths[0]
	assert.ok(path)
	const goal = bot.pathfinder.goal
	for (const threats of [
		[nearby, threat(2, 0, 48)],
		[nearby],
		[nearby, threat(3, 0, 49)]
	]) {
		assert.ok(
			new EscapeSafety(origin, threats, preferences).allowsPath(
				origin,
				path,
				true
			)
		)
		setGoal.mock.resetCalls()
		escape.move(nearby, threats, null)
		assert.equal(
			setGoal.mock.callCount(),
			0,
			'safe route must not be stopped or replaced'
		)
		assert.equal(bot.pathfinder.goal, goal)
	}
})
