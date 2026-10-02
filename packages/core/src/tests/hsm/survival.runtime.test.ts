import assert from 'node:assert/strict'
import test from 'node:test'
import { setImmediate as flush } from 'node:timers/promises'

import { Vec3 } from 'vec3'

import { createHarness } from './fixtures/handoffBot.js'

test('real movement and physics increase separation in every flee direction, with a pathfinder fallback', async t => {
	t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] })
	for (const useMovement of [true, false]) {
		for (const [x, z] of [
			[1.5, 0],
			[-1.5, 0],
			[0, 1.5],
			[0, -1.5]
		] as const) {
			const { bot, actor, enemy, observe, step } = createHarness()
			try {
				if (!useMovement) Object.assign(bot, { movement: undefined })
				enemy.position = new Vec3(x, 64, z)
				actor.send({ type: 'UPDATE_HEALTH', health: 8 })
				observe()
				await flush()
				const before = bot.entity.position.distanceTo(enemy.position)
				for (let i = 0; i < 24; i++) {
					t.mock.timers.tick(50)
					await flush()
					step()
				}
				assert.ok(
					bot.entity.position.distanceTo(enemy.position) > before + 1,
					`Flee direction ${x},${z}, movement=${useMovement}`
				)
				assert.equal(bot.digCalls.length, 0)
				assert.equal(bot.placeCalls.length, 0)
			} finally {
				actor.stop()
			}
		}
	}
})

test('a survival obligation has no sixty-second deadline', async t => {
	t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] })
	const { bot, actor } = createHarness()
	t.after(() => actor.stop())
	actor.send({ type: 'UPDATE_FOOD', food: 16 })
	actor.send({ type: 'UPDATE_HEALTH', health: 8 })
	await flush()
	t.mock.timers.tick(61000)
	await flush()
	assert.ok(
		actor
			.getSnapshot()
			.matches({ MAIN_ACTIVITY: { URGENT_NEEDS: 'EMERGENCY_HEALING' } })
	)
	assert.equal(actor.getSnapshot().context.recoveryFailure, null)
	assert.equal(bot.chatMessages.length, 1)
})

test('a world-query failure cancels the failed attempt, then retries without releasing survival', async t => {
	t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] })
	const { bot, actor, enemy, observe } = createHarness()
	t.after(() => actor.stop())
	enemy.position = new Vec3(18, 64, 0)
	actor.send({ type: 'UPDATE_HEALTH', health: 8 })
	observe()
	const blockAt = bot.blockAt.bind(bot)
	bot.blockAt = () => {
		throw new Error('world unavailable')
	}
	await flush()
	t.mock.timers.tick(100)
	await flush()
	assert.ok(
		actor.getSnapshot().matches({
			MAIN_ACTIVITY: { URGENT_NEEDS: { EMERGENCY_HEALING: 'RETRYING' } }
		})
	)
	bot.blockAt = blockAt
	t.mock.timers.tick(1000)
	await flush()
	t.mock.timers.tick(100)
	await flush()
	assert.equal(actor.getSnapshot().context.movementOwner, 'PATHFINDER')
})

test('medium-distance escape keeps its route while the bot makes actual progress', async t => {
	t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] })
	const { bot, actor, enemy, observe, step } = createHarness()
	t.after(() => actor.stop())
	enemy.position = new Vec3(18, 64, 0)
	actor.send({ type: 'UPDATE_HEALTH', health: 8 })
	observe()
	await flush()
	for (let i = 0; i < 24; i++) {
		t.mock.timers.tick(50)
		await flush()
		step()
	}
	assert.ok(bot.entity.position.x < -2)
	assert.equal(actor.getSnapshot().context.movementOwner, 'PATHFINDER')
})
