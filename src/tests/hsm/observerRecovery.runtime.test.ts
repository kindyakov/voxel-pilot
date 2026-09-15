import assert from 'node:assert/strict'
import test from 'node:test'
import { setImmediate as flush } from 'node:timers/promises'

import { createHarness } from './fixtures/handoffBot'

test('a failed observer retries itself and recovery reacts to a newly appearing threat', async t => {
	t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] })
	const { bot, actor, enemy, step } = createHarness(true)
	t.after(() => actor.stop())
	actor.send({ type: 'UPDATE_HEALTH', health: 8 })
	await flush()
	t.mock.timers.tick(100)
	await flush()
	const getRangeWeapon = bot.utils.getRangeWeapon.bind(bot.utils)
	bot.utils.getRangeWeapon = () => {
		throw new Error('temporary inventory observation failure')
	}
	t.mock.timers.tick(100)
	await flush()
	bot.utils.getRangeWeapon = getRangeWeapon
	bot.entities = { [enemy.id]: enemy }
	for (let i = 0; i < 60; i++) {
		t.mock.timers.tick(50)
		await flush()
		step()
	}
	assert.equal(actor.getSnapshot().context.nearestThreat?.entityId, enemy.id)
	assert.ok(
		bot.entity.position.x < -2,
		'the restarted observer must enable actual escape'
	)
	assert.equal(
		actor.getSnapshot().context.recoveryFailure,
		null,
		'observer failure must not be reported as eating failure'
	)
	assert.equal(bot.attacks.length, 0)
})

test('persistent observation failures have bounded retries and do not prove safety', async t => {
	t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] })
	const { bot, actor } = createHarness(true)
	t.after(() => actor.stop())
	let attempts = 0
	bot.utils.getRangeWeapon = () => {
		attempts++
		throw new Error('inventory unavailable')
	}
	await flush()
	for (let i = 0; i < 50; i++) {
		t.mock.timers.tick(100)
		await flush()
	}
	assert.ok(
		attempts >= 2 && attempts <= 5,
		`expected bounded retries, got ${attempts}`
	)
	assert.equal(actor.getSnapshot().context.threatObservationAt, null)
	assert.equal(bot.attacks.length, 0)
	assert.equal(bot.usingItem, false)
})
