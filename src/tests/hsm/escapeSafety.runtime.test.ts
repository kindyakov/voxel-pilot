import assert from 'node:assert/strict'
import test from 'node:test'
import { setImmediate as flush } from 'node:timers/promises'

import { Vec3 } from 'vec3'

import { createEntityFixture, createHarness } from './fixtures/handoffBot'

for (const enemyX of [3, 18]) {
	test(`a corridor toward an enemy at ${enemyX} is not an escape route`, async t => {
		t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] })
		const { bot, actor, enemy, observe, step } = createHarness()
		t.after(() => actor.stop())
		let opened = false
		bot.solidAt = position =>
			position.y < 64 ||
			(position.y < 72 &&
				((!opened && Math.floor(position.x) < -1) ||
					Math.floor(position.x) > 30 ||
					Math.abs(Math.floor(position.z)) > 1))
		enemy.position = new Vec3(enemyX, 64, 0)
		actor.send({ type: 'UPDATE_HEALTH', health: 8 })
		observe()
		await flush()
		let closest = enemyX
		for (let tick = 0; tick < 180; tick++) {
			t.mock.timers.tick(50)
			await flush()
			step()
			closest = Math.min(
				closest,
				bot.entity.position.distanceTo(enemy.position)
			)
		}
		assert.ok(
			closest >= enemyX - 0.5,
			`escape approached the enemy: ${closest}`
		)
		assert.equal(
			bot.chatMessages.filter(message => /выход не найден/.test(message))
				.length,
			1
		)
		opened = true
		bot.emit('blockUpdate', null, bot.blockAt(new Vec3(-2, 64, 0)))
		for (let tick = 0; tick < 120; tick++) {
			t.mock.timers.tick(50)
			await flush()
			step()
		}
		assert.ok(
			bot.entity.position.x < -5,
			'an actual safe opening must permit escape'
		)
		assert.equal(bot.attacks.length, 0)
		assert.equal(bot.digCalls.length, 0)
		assert.equal(bot.placeCalls.length, 0)
	})
}

test('a lateral detour around a blocked escape direction still moves away', async t => {
	t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] })
	const { bot, actor, enemy, observe, step } = createHarness()
	t.after(() => actor.stop())
	bot.solidAt = position =>
		position.y < 64 ||
		(position.y < 72 &&
			Math.floor(position.x) === -2 &&
			Math.abs(position.z) < 4)
	enemy.position = new Vec3(18, 64, 0)
	actor.send({ type: 'UPDATE_HEALTH', health: 8 })
	observe()
	await flush()
	for (let tick = 0; tick < 180; tick++) {
		t.mock.timers.tick(50)
		await flush()
		step()
	}
	assert.ok(bot.entity.position.distanceTo(enemy.position) >= 29)
	assert.ok(bot.entity.position.x < -5)
	assert.equal(bot.digCalls.length, 0)
	assert.equal(bot.placeCalls.length, 0)
})

test('escape between two close attackers increases clearance from both', async t => {
	t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] })
	const { bot, actor, enemy, step } = createHarness(true)
	t.after(() => actor.stop())
	enemy.position = new Vec3(2, 64, 0)
	const other = createEntityFixture({
		...enemy,
		id: 2,
		position: new Vec3(-3, 64, 0)
	})
	bot.entities = { 1: enemy, 2: other }
	actor.send({ type: 'UPDATE_HEALTH', health: 8 })
	await flush()
	let closest = 2
	for (let tick = 0; tick < 120; tick++) {
		t.mock.timers.tick(50)
		await flush()
		step()
		closest = Math.min(
			closest,
			bot.entity.position.distanceTo(enemy.position),
			bot.entity.position.distanceTo(other.position)
		)
	}
	assert.ok(closest >= 1.5, `escape crossed an attacker at distance ${closest}`)
	assert.ok(bot.entity.position.distanceTo(enemy.position) > 15)
	assert.ok(bot.entity.position.distanceTo(other.position) > 15)
	assert.equal(bot.attacks.length, 0)
})

for (const change of ['moves', 'disappears']) {
	test(`a blocked escape resumes when the non-nearest threat ${change}`, async t => {
		t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] })
		const { bot, actor, enemy, step } = createHarness(true)
		t.after(() => actor.stop())
		bot.solidAt = position =>
			position.y < 64 ||
			(position.y < 72 && Math.abs(Math.floor(position.z)) > 1)
		enemy.position = new Vec3(3, 64, 0)
		const other = createEntityFixture({
			...enemy,
			id: 2,
			position: new Vec3(-4, 64, 0)
		})
		bot.entities = { 1: enemy, 2: other }
		actor.send({ type: 'UPDATE_HEALTH', health: 8 })
		await flush()
		for (let tick = 0; tick < 180; tick++) {
			t.mock.timers.tick(50)
			await flush()
			step()
		}
		assert.equal(bot.entity.position.x, 0)
		assert.equal(
			bot.chatMessages.filter(message => /выход не найден/.test(message))
				.length,
			1,
			'unchanged threats must not restart exhausted route searches'
		)
		if (change === 'moves') other.position = new Vec3(35, 64, 0)
		else bot.entities = { 1: enemy }
		// No block update: only the secondary threat changes the safe routes.
		for (let tick = 0; tick < 120; tick++) {
			t.mock.timers.tick(50)
			await flush()
			step()
		}
		assert.ok(
			bot.entity.position.x < -5,
			'the freed corridor must permit escape'
		)
		assert.equal(actor.getSnapshot().context.nearestThreat?.entityId, enemy.id)
		assert.equal(bot.attacks.length, 0)
		assert.equal(bot.digCalls.length, 0)
		assert.equal(bot.placeCalls.length, 0)
	})
}

test('a moving secondary threat cannot be crossed on an active lateral route', async t => {
	t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] })
	const { bot, actor, enemy, step } = createHarness(true)
	t.after(() => actor.stop())
	Object.assign(bot, { movement: undefined })
	bot.solidAt = position =>
		position.y < 64 ||
		(position.y < 72 &&
			Math.floor(position.x) === -2 &&
			Math.abs(position.z) < 4)
	enemy.position = new Vec3(3, 64, 0)
	const other = createEntityFixture({
		...enemy,
		id: 2,
		position: new Vec3(35, 64, 0)
	})
	bot.entities = { 1: enemy, 2: other }
	actor.send({ type: 'UPDATE_HEALTH', health: 8 })
	await flush()
	for (
		let tick = 0;
		tick < 100 && Math.abs(bot.entity.position.z) < 0.4;
		tick++
	) {
		t.mock.timers.tick(50)
		await flush()
		step()
	}
	assert.ok(
		bot.pathfinder.goal,
		'the real pathfinder must start the lateral detour'
	)
	const before = bot.entity.position.clone()
	other.position = new Vec3(before.x + 0.4, 64, Math.sign(before.z) * 4)
	assert.ok(
		before.distanceTo(other.position) > before.distanceTo(enemy.position)
	)
	let closest = before.distanceTo(other.position)
	for (let tick = 0; tick < 100; tick++) {
		t.mock.timers.tick(50)
		await flush()
		step()
		closest = Math.min(closest, bot.entity.position.distanceTo(other.position))
	}
	assert.ok(
		closest >= 1.5,
		`active escape crossed the secondary threat at ${closest}`
	)
	assert.ok(
		bot.entity.position.distanceTo(before) > 5,
		'a safe replacement must move'
	)
	assert.equal(bot.attacks.length, 0)
	assert.equal(bot.digCalls.length, 0)
	assert.equal(bot.placeCalls.length, 0)
})
