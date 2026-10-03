import assert from 'node:assert/strict'
import test from 'node:test'

import { Vec3 } from 'vec3'

import { recordApproach } from '@/utils/combat/approachPolicy.js'
import { AcceptedApproachRoute } from '@/utils/combat/approachRoute.js'

import { createHarness } from './fixtures/handoffBot.js'

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
