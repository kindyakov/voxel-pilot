import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import test from 'node:test'
import { setImmediate as flush } from 'node:timers/promises'

import { Vec3 } from 'vec3'

import BotStateMachine from '@/core/hsm'
import { MemoryManager } from '@/core/memory'
import { ProfileMemoryStore } from '@/core/profile'

import { createHarness } from '../hsm/fixtures/handoffBot'
import { createEntityFixture } from '../hsm/fixtures/handoffBot'

const deferred = () => {
	let resolve!: () => void
	const promise = new Promise<void>(done => {
		resolve = done
	})
	return { promise, resolve }
}

const fixture = (t: test.TestContext, version = '1.20.4') => {
	t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] })
	const { bot, actor, enemy } = createHarness(false, version)
	actor.stop()
	const memory = new MemoryManager({ botName: bot.username })
	const profile = new ProfileMemoryStore({ botName: bot.username })
	bot.asBot().memory = memory
	bot.asBot().profileMemory = profile
	const load = t.mock.method(memory, 'load', async () => {})
	const save = t.mock.method(memory, 'save', async () => {})
	const close = t.mock.method(memory, 'close', () => {})
	const profileLoad = t.mock.method(profile, 'load', async () => {})
	const profileClose = t.mock.method(profile, 'close', () => {})
	return { bot, enemy, load, save, close, profileLoad, profileClose }
}

test('HSM starts from the current vitals without issuing low-health attacks', async t => {
	const { bot, enemy } = fixture(t)
	bot.health = 8
	bot.food = 5
	bot.foodSaturation = 2
	bot.oxygenLevel = 12
	const hsm = new BotStateMachine(bot.asBot())
	t.after(() => hsm.stop())
	await flush()
	assert.equal(hsm.getContext().health, 8)
	assert.equal(hsm.getContext().food, 5)
	assert.equal(hsm.getContext().foodSaturation, 2)
	assert.equal(hsm.getContext().oxygenLevel, 12)
	bot.entities = { 1: enemy }
	for (let i = 0; i < 20; i++) {
		t.mock.timers.tick(100)
		await flush()
		bot.emit('physicsTick')
		bot.emit('physicTick')
	}
	assert.equal(bot.attacks.length, 0)
	assert.ok(
		hsm.isInState({ MAIN_ACTIVITY: { URGENT_NEEDS: 'EMERGENCY_HEALING' } })
	)
})

test('damage during memory loading is reflected before a queued combat command can run', async t => {
	const { bot, enemy, load } = fixture(t)
	const loading = deferred()
	load.mock.mockImplementation(() => loading.promise)
	const hsm = new BotStateMachine(bot.asBot())
	t.after(() => hsm.stop())
	hsm.send({ type: 'START_COMBAT', target: enemy })
	bot.health = 8
	bot.food = 5
	bot.entities = { [enemy.id]: enemy }
	bot.emit('health')
	loading.resolve()
	assert.equal(await hsm.ready, true)
	assert.equal(hsm.getContext().health, 8)
	assert.equal(hsm.getContext().food, 5)
	for (let i = 0; i < 10; i++) {
		t.mock.timers.tick(100)
		await flush()
		bot.emit('physicsTick')
	}
	assert.equal(bot.attacks.length, 0)
	assert.ok(
		hsm.isInState({ MAIN_ACTIVITY: { URGENT_NEEDS: 'EMERGENCY_HEALING' } })
	)
})

test('stop cancels pending startup immediately and late loading only closes its store', async t => {
	const { bot, enemy, load, close, profileLoad } = fixture(t)
	const loading = deferred()
	load.mock.mockImplementation(() => loading.promise)
	const healthListeners = bot.listenerCount('health')
	const hsm = new BotStateMachine(bot.asBot())
	t.after(() => hsm.stop())
	let stopped = false
	void Promise.resolve(hsm.stop()).then(() => {
		stopped = true
	})
	await flush()
	assert.equal(stopped, true, 'shutdown cannot wait for an unresolved load')
	loading.resolve()
	await flush()
	bot.entities = { 1: enemy }
	for (let i = 0; i < 20; i++) {
		t.mock.timers.tick(100)
		await flush()
		bot.emit('physicsTick')
		bot.emit('physicTick')
	}
	assert.equal(bot.attacks.length, 0)
	assert.equal(bot.listenerCount('health'), healthListeners)
	assert.equal(profileLoad.mock.callCount(), 0)
	assert.equal(close.mock.callCount(), 1)
})

test('stopping a ready HSM removes its subscriptions and closes each store once', async t => {
	const { bot, close, profileClose } = fixture(t)
	const healthListeners = bot.listenerCount('health')
	const hsm = new BotStateMachine(bot.asBot())
	await flush()
	await hsm.stop()
	await hsm.stop()
	assert.equal(bot.listenerCount('health'), healthListeners)
	assert.equal(close.mock.callCount(), 1)
	assert.equal(profileClose.mock.callCount(), 1)
})

test('stop during profile loading closes loaded memory now and the profile when its load settles', async t => {
	const { bot, close, profileLoad, profileClose } = fixture(t)
	const loading = deferred()
	profileLoad.mock.mockImplementation(() => loading.promise)
	const hsm = new BotStateMachine(bot.asBot())
	await flush()
	await hsm.stop()
	assert.equal(await hsm.ready, false)
	assert.equal(close.mock.callCount(), 1)
	assert.equal(profileClose.mock.callCount(), 0)
	loading.resolve()
	await flush()
	assert.equal(profileClose.mock.callCount(), 1)
	assert.equal(bot.listenerCount('health'), 0)
})

for (const version of ['1.20.1', '1.20.4', '1.20.6'])
	test(`a dead mob is excluded before destroy and IDs can be reused on ${version}`, async t => {
		const { bot, enemy } = fixture(t, version)
		createRequire(import.meta.url)('mineflayer/lib/plugins/entities')(bot)
		bot.attack = target => {
			bot.attacks.push(target.id)
		}
		const other = createEntityFixture({
			...enemy,
			id: 2,
			position: new Vec3(3, 64, 0)
		})
		bot.entities = { 1: enemy, 2: other }
		const hsm = new BotStateMachine(bot.asBot())
		t.after(() => hsm.stop())
		await hsm.ready
		t.mock.timers.tick(100)
		await flush()
		assert.equal(hsm.getContext().combatTarget.entity?.id, enemy.id)
		const equipCount = bot.equippedItems.length
		bot._client.emit('entity_status', { entityId: enemy.id, entityStatus: 3 })
		assert.equal(
			hsm.getContext().combatTarget.entity?.id,
			other.id,
			'retarget without exiting combat'
		)
		assert.ok(
			!hsm.getContext().threats.some(threat => threat.entityId === enemy.id)
		)
		bot.emit('physicsTick')
		await flush()
		assert.equal(bot.pvp.target?.id, other.id)
		assert.equal(
			bot.equippedItems.length,
			equipCount,
			'retarget does not re-equip'
		)
		for (let i = 0; i < 25; i++) {
			t.mock.timers.tick(100)
			await flush()
			assert.equal(hsm.getContext().combatTarget.entity?.id, other.id)
			assert.ok(
				!hsm.getContext().threats.some(threat => threat.entityId === enemy.id)
			)
		}
		assert.ok(bot.entities[enemy.id], 'Mineflayer still holds the corpse')
		bot._client.emit('entity_destroy', { entityIds: [enemy.id] })
		const replacement = createEntityFixture({
			...enemy,
			position: new Vec3(1, 64, 0),
			isValid: true
		})
		bot.entities[replacement.id] = replacement
		t.mock.timers.tick(100)
		await flush()
		assert.equal(
			hsm.getContext().combatTarget.entity,
			replacement,
			'reused ID is not a permanent blacklist'
		)
		assert.equal(
			hsm.getContext().deadEntities.size,
			0,
			'released entity objects are not retained'
		)
	})
