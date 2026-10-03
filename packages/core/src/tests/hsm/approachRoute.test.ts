import assert from 'node:assert/strict'
import test from 'node:test'

import { Vec3 } from 'vec3'

import {
	recordApproach,
	resumeApproach
} from '@/utils/combat/approachPolicy.js'
import { AcceptedApproachRoute } from '@/utils/combat/approachRoute.js'

import { createHarness } from './fixtures/handoffBot.js'

test('accepted detour traversal continues beyond 8192 points with bounded encounter memory', t => {
	t.mock.timers.enable({ apis: ['Date'] })
	const { bot, actor, enemy, observe } = createHarness()
	t.after(() => actor.stop())
	enemy.position = new Vec3(7, 64, 0)
	observe()
	let context = actor.getSnapshot().context
	const initial = recordApproach(context, false)[enemy.id]!
	context = { ...context, approachAttempts: { [enemy.id]: initial } }
	for (let i = 1; i <= 9000; i++) {
		bot.entity.position = new Vec3(0, 64, i)
		t.mock.timers.tick(1000)
		context = {
			...context,
			approachAttempts: recordApproach(
				context,
				false,
				bot.entity.position.clone()
			)
		}
		assert.equal(
			context.approachAttempts[enemy.id]!.blocked,
			false,
			`point ${i}`
		)
		assert.equal(
			context.approachAttempts[enemy.id]!.progress!.at,
			Date.now(),
			`point ${i} did not renew progress`
		)
	}
	assert.ok(JSON.stringify(context.approachAttempts[enemy.id]).length < 2000)
})

test('native paths longer than 8192 points remain observable without copying their geometry', () => {
	const route = new AcceptedApproachRoute()
	const path = Array.from({ length: 9000 }, (_, i) => new Vec3(0, 64, i))
	route.publish(path)
	assert.equal(route.sample(path[0]!), undefined)
	const first = path.shift()!
	assert.deepEqual(route.sample(first), first)
})

test('a periodic accepted waypoint loop longer than 8192 points exhausts progress without evicting its evidence', t => {
	t.mock.timers.enable({ apis: ['Date'] })
	const { bot, actor, enemy, observe } = createHarness()
	t.after(() => actor.stop())
	enemy.position = new Vec3(7, 64, 0)
	observe()
	let context = actor.getSnapshot().context
	context = { ...context, approachAttempts: recordApproach(context, false) }
	// A large square returns to the same native integer waypoint sequence.
	const side = 2100
	const point = (i: number) => {
		const offset = i % side
		switch (Math.floor(i / side)) {
			case 0:
				return new Vec3(-offset, 64, 0)
			case 1:
				return new Vec3(-side, 64, offset)
			case 2:
				return new Vec3(-side + offset, 64, side)
			default:
				return new Vec3(0, 64, side - offset)
		}
	}
	let samples = 0
	for (
		;
		samples < side * 16 && !context.approachAttempts[enemy.id]!.blocked;
		samples++
	) {
		bot.entity.position = point(samples % (side * 4))
		t.mock.timers.tick(100)
		context = {
			...context,
			approachAttempts: recordApproach(
				context,
				false,
				bot.entity.position.clone()
			)
		}
	}
	assert.ok(samples > 8192, 'large first traversal should remain permitted')
	const blocked = context.approachAttempts[enemy.id]!
	assert.equal(blocked.blocked, true)
	assert.equal(blocked.routeCycle.detected, true)
	assert.ok(JSON.stringify(blocked).length < 2000)
	const checkpoint = blocked.routeCycle.checkpoint
	context = {
		...context,
		approachAttempts: { [enemy.id]: { ...blocked, worldChanged: true } }
	}
	context = { ...context, approachAttempts: resumeApproach(context) }
	assert.equal(context.approachAttempts[enemy.id]!.resumes, blocked.resumes + 1)
	assert.equal(
		context.approachAttempts[enemy.id]!.routeCycle.checkpoint,
		checkpoint
	)
	context = { ...context, approachAttempts: recordApproach(context, false) }
	bot.entity.position = bot.entity.position.offset(-side * 2, 0, side * 2)
	t.mock.timers.tick(context.preferences.approachNoProgressMs)
	const resumed = recordApproach(context, false, bot.entity.position.clone())[
		enemy.id
	]!
	assert.equal(
		resumed.blocked,
		false,
		'new route after a meaningful world change is allowed'
	)
	assert.equal(resumed.progress!.at, Date.now())
})

test('route publication and shortened stationary partial plans do not prove accepted traversal; reset invalidates old arrays', () => {
	const route = new AcceptedApproachRoute()
	const path = [new Vec3(0, 64, 0), new Vec3(0, 64, 1), new Vec3(0, 64, 2)]
	route.publish(path)
	assert.equal(route.sample(new Vec3(0, 64, 0)), undefined)
	route.publish(path.slice(1))
	assert.equal(route.sample(new Vec3(0, 64, 1)), undefined)
	const accepted = path.slice()
	route.publish(accepted)
	accepted.shift()
	assert.deepEqual(route.sample(new Vec3(0, 64, 0)), new Vec3(0, 64, 0))
	route.clear()
	accepted.shift()
	assert.equal(route.sample(new Vec3(0, 64, 1)), undefined)
})

test('encounter route history rejects equivalent replan replay and circular displacement instead of renewing deadline', t => {
	t.mock.timers.enable({ apis: ['Date'] })
	const { bot, actor, enemy, observe } = createHarness()
	t.after(() => actor.stop())
	enemy.position = new Vec3(7, 64, 0)
	observe()
	let context = actor.getSnapshot().context
	context = { ...context, approachAttempts: recordApproach(context, false) }
	bot.entity.position = new Vec3(0, 64, 1)
	t.mock.timers.tick(1000)
	context = {
		...context,
		approachAttempts: recordApproach(
			context,
			false,
			bot.entity.position.clone()
		)
	}
	const lastCredit = context.approachAttempts[enemy.id]!.progress!.at
	assert.equal(lastCredit, Date.now())
	// Returning to the old anchor is not progress; an equivalent plan replay is already credited.
	bot.entity.position = new Vec3(0, 64, 0)
	t.mock.timers.tick(1000)
	context = { ...context, approachAttempts: recordApproach(context, false) }
	bot.entity.position = new Vec3(0, 64, 1)
	t.mock.timers.tick(2000)
	context = {
		...context,
		approachAttempts: recordApproach(
			context,
			false,
			bot.entity.position.clone()
		)
	}
	assert.equal(context.approachAttempts[enemy.id]!.progress!.at, lastCredit)
	assert.equal(context.approachAttempts[enemy.id]!.blocked, true)
})

test('stationary native prefix consumption and off-route movement do not count as progress', t => {
	t.mock.timers.enable({ apis: ['Date'] })
	const { bot, actor, enemy, observe } = createHarness()
	t.after(() => actor.stop())
	enemy.position = new Vec3(7, 64, 0)
	observe()
	let context = actor.getSnapshot().context
	context = { ...context, approachAttempts: recordApproach(context, false) }
	const initialAt = context.approachAttempts[enemy.id]!.progress!.at
	t.mock.timers.tick(2999)
	context = {
		...context,
		approachAttempts: recordApproach(
			context,
			false,
			bot.entity.position.clone()
		)
	}
	assert.equal(context.approachAttempts[enemy.id]!.progress!.at, initialAt)
	assert.equal(context.approachAttempts[enemy.id]!.blocked, false)
	bot.entity.position = new Vec3(0, 64, 2)
	t.mock.timers.tick(1)
	context = {
		...context,
		approachAttempts: recordApproach(context, false, new Vec3(10, 64, 10))
	}
	assert.equal(context.approachAttempts[enemy.id]!.progress!.at, initialAt)
	assert.equal(context.approachAttempts[enemy.id]!.blocked, true)
})
