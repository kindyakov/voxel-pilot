import assert from 'node:assert/strict'
import test from 'node:test'
import { setImmediate as flush } from 'node:timers/promises'

import pathfinderPackage from 'mineflayer-pathfinder'
import { Vec3 } from 'vec3'

import { loadPvp } from '@/modules/plugins/pvp.js'

import { canSeeEnemy } from '@/utils/combat/enemyVisibility.js'

import { HandoffBot, createEntityFixture } from './fixtures/handoffBot.js'

const deferred = () => {
	let resolve: () => void = () => {}
	const promise = new Promise<void>(done => {
		resolve = done
	})
	return { promise, resolve }
}

const fixture = () => {
	const bot = new HandoffBot()
	bot.loadPlugin(pathfinderPackage.pathfinder)
	loadPvp(bot.asBot())
	const target = createEntityFixture({
		id: 1,
		name: 'zombie',
		position: new Vec3(2, 64, 0),
		height: 1.8,
		isValid: true
	})
	bot.entities[target.id] = target
	return { bot, target, tick: () => bot.emit('physicTick') }
}

test('native permission blocks hits through a wall while preserving the follow target', async t => {
	const { bot, target, tick } = fixture()
	t.after(() => bot.pvp.forceStop())
	bot.solidAt = position =>
		position.y < 64 || (Math.floor(position.x) === 1 && position.y < 67)
	await bot.pvp.attack(target, {
		canAttack: enemy => canSeeEnemy(bot.asBot(), enemy)
	})
	tick()
	await flush()
	assert.equal(bot.attacks.length, 0)
	assert.equal(bot.pvp.target, target)
	assert.ok(bot.pathfinder.goal, 'permission denial does not cancel navigation')
	bot.solidAt = position => position.y < 64
	for (let i = 0; i < 30; i++) tick()
	await flush()
	assert.deepEqual(
		bot.attacks,
		[target.id],
		'same controller can attack once LOS returns'
	)
})

for (const changed of [
	'out_of_range',
	'invalid_target',
	'wall',
	'permission_revoked'
] as const) {
	test(`native hit rechecks ${changed} after delayed aim`, async t => {
		const { bot, target, tick } = fixture()
		t.after(() => bot.pvp.forceStop())
		const aim = deferred()
		bot.aimGate = aim.promise
		let allowed = true
		await bot.pvp.attack(target, {
			canAttack: enemy => allowed && canSeeEnemy(bot.asBot(), enemy)
		})
		tick()
		await flush()
		assert.equal(bot.attacks.length, 0)
		if (changed === 'out_of_range') target.position = new Vec3(10, 64, 0)
		if (changed === 'invalid_target') target.isValid = false
		if (changed === 'permission_revoked') allowed = false
		if (changed === 'wall')
			bot.solidAt = position =>
				position.y < 64 || (Math.floor(position.x) === 1 && position.y < 67)
		aim.resolve()
		await flush()
		assert.equal(bot.attacks.length, 0)
		// Restore conditions and prove rejection leaves a usable controller.
		target.position = new Vec3(2, 64, 0)
		target.isValid = true
		allowed = true
		bot.solidAt = position => position.y < 64
		for (let i = 0; i < 30; i++) tick()
		await flush()
		assert.deepEqual(bot.attacks, [target.id])
	})
}

test('late aim from the canceled owner cannot hit or clear the new owner', async t => {
	const { bot, target, tick } = fixture()
	t.after(() => bot.pvp.forceStop())
	const aim = deferred()
	bot.aimGate = aim.promise
	await bot.pvp.attack(target, { canAttack: () => true })
	tick()
	await flush()
	bot.pvp.forceStop()
	const next = createEntityFixture({
		id: 2,
		name: 'zombie',
		position: new Vec3(0, 64, 2),
		height: 1.8,
		isValid: true
	})
	bot.entities[next.id] = next
	bot.aimGate = Promise.resolve()
	await bot.pvp.attack(next, { canAttack: () => true })
	tick()
	await flush()
	assert.deepEqual(bot.attacks, [next.id])
	const nextGoal = bot.pathfinder.goal
	aim.resolve()
	await flush()
	assert.deepEqual(bot.attacks, [next.id])
	assert.equal(bot.pvp.target, next)
	assert.equal(bot.pathfinder.goal, nextGoal)
})

test('native geometry guard rejects invalid coordinates even if permission allows', async t => {
	const { bot, target, tick } = fixture()
	t.after(() => bot.pvp.forceStop())
	const aim = deferred()
	bot.aimGate = aim.promise
	await bot.pvp.attack(target, { canAttack: () => true })
	tick()
	await flush()
	target.position = new Vec3(NaN, 64, 0)
	aim.resolve()
	await flush()
	assert.equal(bot.attacks.length, 0)
})

test('reissuing the same target replaces its final-hit permission', async t => {
	const { bot, target, tick } = fixture()
	t.after(() => bot.pvp.forceStop())
	const aim = deferred()
	bot.aimGate = aim.promise
	await bot.pvp.attack(target, { canAttack: () => true })
	tick()
	await flush()
	await bot.pvp.attack(target, { canAttack: () => false })
	aim.resolve()
	await flush()
	assert.equal(bot.attacks.length, 0)
	assert.equal(bot.pvp.target, target)
})

test('permission cannot allow a final hit after synchronously canceling the owner', async t => {
	const { bot, target, tick } = fixture()
	t.after(() => bot.pvp.forceStop())
	await bot.pvp.attack(target, {
		canAttack: () => {
			bot.pvp.forceStop()
			return true
		}
	})
	tick()
	await flush()
	assert.equal(bot.attacks.length, 0)
	assert.equal(bot.pvp.target, undefined)
})
