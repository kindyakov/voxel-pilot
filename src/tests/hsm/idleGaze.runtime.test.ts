import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import test from 'node:test'
import { setImmediate as flush } from 'node:timers/promises'

import { Vec3 } from 'vec3'
import { createActor, fromPromise } from 'xstate'

import type { Bot } from '@/types/index.js'

import { createBotMachine } from '@/hsm/machine.js'

import { loadHawkeye } from '@/modules/plugins/hawkeye.js'

import { createEntityFixture, createHarness } from './fixtures/handoffBot.js'

const require = createRequire(import.meta.url)
const World = require('prismarine-world')('1.20.6')
const ItemFactory = require('prismarine-item')('1.20.6')
const BlockFactory = require('prismarine-block')('1.20.6')

const fixture = async (t: test.TestContext) => {
	t.mock.timers.enable({ apis: ['Date', 'setTimeout', 'setInterval'] })
	t.mock.method(Math, 'random', () => 0.5)
	const harness = createHarness(true, '1.20.6')
	const { bot, actor } = harness
	t.after(() => actor.stop())
	// Use the real block-shape raycast, backed by the fixture's flat world.
	const world: Bot['world'] = new World().sync
	Object.assign(world, {
		getBlock: (position: Vec3) => bot.asBot().blockAt(position)
	})
	Object.assign(bot.world, { raycast: world.raycast.bind(world) })
	Object.assign(bot.entity, { eyeHeight: 1.62 })
	const looks: { point: Vec3; force: boolean | undefined }[] = []
	const lookAt = bot.asBot().lookAt.bind(bot)
	t.mock.method(bot.asBot(), 'lookAt', async (point: Vec3, force?: boolean) => {
		looks.push({ point: point.clone(), force })
		await lookAt(point, force)
	})
	let nextId = 100
	const add = (name: string, x: number, z = 0) => {
		const registered = bot.registry.entitiesByName[name]
		const entity = createEntityFixture({
			id: nextId++,
			name,
			type: registered.type,
			height: registered.height,
			width: registered.width,
			position: new Vec3(x, 64, z),
			isValid: true
		})
		if (name === 'player')
			Object.assign(entity, { type: 'player', eyeHeight: 1.62 })
		bot.entities[entity.id] = entity
		return entity
	}
	const tick = async (ms = 100) => {
		t.mock.timers.tick(ms)
		await flush()
		bot.emit('physicsTick')
		await flush()
	}
	await flush()
	return { ...harness, add, looks, tick }
}

test('idle gaze acquires the nearest visible living entity at 8 blocks, from behind, without walking', async t => {
	const { bot, actor, add, looks, tick } = await fixture(t)
	const player = add('player', 0, 8)
	const position = bot.entity.position.clone()
	await tick()
	assert.ok(actor.getSnapshot().matches({ MAIN_ACTIVITY: 'IDLE' }))
	assert.deepEqual(looks.at(-1), {
		point: player.position.offset(0, 1.62, 0),
		force: false
	})
	assert.deepEqual(bot.entity.position, position)
	assert.ok(Object.values(bot.controlState).every(active => !active))
	assert.equal(bot.pathfinder.goal, null)
	const count = looks.length
	player.position.z = 8.01
	await tick()
	assert.equal(looks.length, count)
	add('cow', 2)
	await tick()
	assert.equal(looks.at(-1)?.point.x, 2)
})

test('holds attention for 3–5 seconds despite distance changes and tracks current head position', async t => {
	const { add, looks, tick } = await fixture(t)
	const cow = add('cow', 2)
	const player = add('player', 4)
	await tick()
	assert.equal(looks.at(-1)?.point.x, 2)
	player.position.x = 1
	cow.position.z = 2
	await tick(2999)
	assert.equal(looks.at(-1)?.point.z, 2, 'still tracking the held cow')
	await tick(1001)
	assert.deepEqual(looks.at(-1)?.point, player.position.offset(0, 1.62, 0))
})

test('occasional alternatives are selected only at the hold deadline, then nearest is preferred again', async t => {
	const { add, looks, tick } = await fixture(t)
	add('cow', 2)
	add('player', 4)
	await tick()
	assert.equal(looks.at(-1)?.point.x, 2)
	// First draw: choose an alternative; second: select it; third: hold 4 s.
	const values = [0.1, 0, 0.5]
	t.mock.method(Math, 'random', () => values.shift() ?? 0.5)
	await tick(4000)
	assert.equal(looks.at(-1)?.point.x, 4)
	await tick(500)
	assert.equal(looks.at(-1)?.point.x, 4)
	await tick(3500)
	assert.equal(looks.at(-1)?.point.x, 2)
})

test('walls, ceilings and unloaded space prevent gaze, including after target acquisition', async t => {
	const { bot, add, looks, tick } = await fixture(t)
	const player = add('player', 4)
	await tick()
	const count = looks.length
	bot.solidAt = position => position.y < 64 || Math.floor(position.x) === 2
	await tick()
	assert.equal(looks.length, count, 'a newly built wall breaks tracking')
	bot.solidAt = position => position.y < 64 || Math.floor(position.y) === 67
	player.position.set(0, 69, 0)
	await tick()
	assert.equal(looks.length, count, 'cannot see through the ceiling')
	bot.solidAt = position => position.y < 64
	player.position.set(-4, 64, 0)
	const blockAt = bot.asBot().blockAt.bind(bot)
	t.mock.method(bot.asBot(), 'blockAt', (position: Vec3) =>
		position.x < 0 ? null : blockAt(position)
	)
	await tick()
	assert.equal(
		looks.length,
		count,
		'native raycast skipping unknown columns is not visibility'
	)
})

test('raycasting respects thin block shapes rather than skipping gaps between samples', async t => {
	const { bot, add, looks, tick } = await fixture(t)
	add('player', 4)
	const blockAt = bot.asBot().blockAt.bind(bot)
	t.mock.method(bot.asBot(), 'blockAt', (position: Vec3) => {
		if (Math.floor(position.x) !== 2 || Math.floor(position.y) !== 65)
			return blockAt(position)
		const block = BlockFactory.fromStateId(
			bot.registry.blocksByName.stone.minStateId,
			0
		)
		block.position = position.floored()
		block.shapes = [[0.21, 0, 0, 0.22, 1, 1]]
		return block
	})
	await tick()
	assert.equal(looks.length, 0)
})

test('removal, death and reuse of an ID discard the old held object immediately', async t => {
	const { bot, actor, add, looks, tick } = await fixture(t)
	const cow = add('cow', 2)
	const player = add('player', 4)
	await tick()
	actor.send({ type: 'ENTITY_DIED', entity: cow })
	bot.emit('physicsTick')
	await flush()
	assert.equal(looks.at(-1)?.point.x, 4)
	delete bot.entities[player.id]
	const count = looks.length
	bot.emit('physicsTick')
	await flush()
	assert.equal(
		looks.length,
		count,
		'does not track a despawn while the context snapshot lags'
	)
	const replacement = createEntityFixture({
		...cow,
		position: new Vec3(1, 64, 0)
	})
	bot.entities[cow.id] = replacement
	await tick()
	assert.equal(
		looks.at(-1)?.point.x,
		1,
		'fresh object does not inherit old death or hold'
	)
})

test('passive registry mobs qualify, but nonliving entities and even calm endermen do not', async t => {
	const { bot, add, looks, tick } = await fixture(t)
	for (const name of [
		'cow',
		'trader_llama',
		'wandering_trader',
		'skeleton_horse',
		'allay'
	]) {
		bot.entities = {}
		const entity = add(name, 2)
		const before = looks.length
		await tick()
		assert.ok(looks.length > before, name)
		assert.equal(looks.at(-1)?.point.y, 64 + entity.height * 0.9)
	}
	for (const name of [
		'item',
		'arrow',
		'experience_orb',
		'armor_stand',
		'enderman'
	]) {
		bot.entities = {}
		const entity = add(name, 2)
		if (name === 'enderman') {
			const keys: string[] = bot.registry.entitiesByName.enderman.metadataKeys
			Object.assign(entity.metadata, {
				[keys.indexOf('creepy')]: false,
				[keys.indexOf('stared_at')]: false
			})
		}
		const before = looks.length
		await tick()
		assert.equal(looks.length, before, name)
	}
})

test('a neutral mob requires confirmed calmness and loses gaze when aggression becomes unknown', async t => {
	const { bot, add, looks, tick } = await fixture(t)
	const bee = add('bee', 2)
	const key = bot.registry.entitiesByName.bee.metadataKeys.indexOf(
		'remaining_anger_time'
	)
	await tick()
	assert.equal(looks.length, 0)
	Object.assign(bee.metadata, { [key]: 0 })
	await tick()
	assert.equal(looks.at(-1)?.point.x, 2)
	Object.assign(bee.metadata, { [key]: 10 })
	const before = looks.length
	bot.emit('physicsTick')
	await flush()
	assert.equal(
		looks.length,
		before,
		'recheck live metadata before the observer refresh'
	)
})

test('stale or invalid observations and a dead bot never issue decorative look commands', async t => {
	const { bot, actor, add, looks, tick } = await fixture(t)
	add('player', 2)
	await tick()
	const before = looks.length
	// A single delayed physics callback sees the stale context before timers publish again.
	t.mock.timers.setTime(Date.now() + 3000)
	bot.emit('physicsTick')
	await flush()
	assert.equal(looks.length, before)
	actor.send({
		type: 'THREAT_OBSERVATION_INVALID',
		reason: 'invalid_bot_position'
	})
	bot.emit('physicsTick')
	await flush()
	assert.equal(looks.length, before)
	actor.send({ type: 'DEATH' })
	await tick()
	assert.ok(actor.getSnapshot().matches({ MAIN_ACTIVITY: 'IDLE' }))
	assert.equal(looks.length, before)
})

test('leaving idle stops even an already queued gaze callback and does not reset the new aim', async t => {
	const { bot, actor, add, looks, tick } = await fixture(t)
	add('player', 2)
	await tick()
	const before = looks.length
	const listeners = bot.listenerCount('physicsTick')
	bot.prependOnceListener('physicsTick', () => {
		actor.send({ type: 'UPDATE_HEALTH', health: 8 })
		void bot.look(1.25, 0.5)
	})
	bot.emit('physicsTick')
	await flush()
	assert.equal(looks.length, before)
	assert.equal(bot.entity.yaw, 1.25)
	assert.ok(
		actor
			.getSnapshot()
			.matches({ MAIN_ACTIVITY: { URGENT_NEEDS: 'EMERGENCY_HEALING' } })
	)
	assert.ok(!actor.getSnapshot().children.idleGaze)
	// Recovery is allowed to own its own subscriptions; the canceled one is gone.
	assert.ok(bot.listenerCount('physicsTick') <= listeners)
})

test('ranged combat owns aim even with movementOwner NONE and idle gaze resumes after combat', async t => {
	const { bot, actor, add, looks, tick } = await fixture(t)
	add('player', -2)
	await tick()
	const before = looks.length
	loadHawkeye(bot.asBot())
	bot.inventory.items = () =>
		['bow', 'arrow'].map(
			name => new ItemFactory(bot.registry.itemsByName[name].id, 16)
		)
	const enemy = add('zombie', 15)
	await tick()
	assert.ok(
		actor
			.getSnapshot()
			.matches({ MAIN_ACTIVITY: { COMBAT: 'RANGED_SKIRMISHING' } })
	)
	assert.equal(actor.getSnapshot().context.movementOwner, 'NONE')
	await tick()
	assert.ok(looks.slice(before).every(call => call.point.x !== -2))
	actor.send({ type: 'ENTITY_DIED', entity: enemy })
	await tick()
	assert.ok(actor.getSnapshot().matches({ MAIN_ACTIVITY: 'IDLE' }))
	assert.equal(looks.at(-1)?.point.x, -2)
})

for (const result of ['resolve', 'reject'] as const)
	test(`a late gaze ${result} after stop cannot write again or affect a new owner`, async t => {
		const { bot, actor, add, looks, tick } = await fixture(t)
		let finish = () => {}
		bot.aimGate = new Promise<void>((resolve, reject) => {
			finish =
				result === 'resolve'
					? resolve
					: () => reject(new Error('old aim failed'))
		})
		add('player', 2)
		await tick()
		const before = looks.length
		assert.ok(before > 0)
		actor.stop()
		await bot.look(2.5, 0.25)
		finish()
		await flush()
		await tick(6000)
		assert.equal(looks.length, before)
		assert.equal(bot.entity.yaw, 2.5)
		assert.equal(actor.getSnapshot().status, 'stopped')
	})

test('gaze errors stop their own actor without restarting idle or blocking later combat', async t => {
	const { bot, actor, add, looks, tick } = await fixture(t)
	t.mock.method(bot.asBot(), 'lookAt', async () => {
		throw new Error('look failed')
	})
	add('player', 2)
	await tick()
	assert.ok(actor.getSnapshot().matches({ MAIN_ACTIVITY: 'IDLE' }))
	assert.ok(!actor.getSnapshot().children.idleGaze)
	await tick(6000)
	assert.equal(looks.length, 0)
	add('zombie', 4)
	await tick()
	assert.ok(
		actor
			.getSnapshot()
			.matches({ MAIN_ACTIVITY: { COMBAT: 'MELEE_ATTACKING' } })
	)
})

test('idle radius is a separate validated preference', () => {
	assert.doesNotThrow(() =>
		createBotMachine({ preferences: { idleGazeRadius: 4 } })
	)
	for (const idleGazeRadius of [0, -1, NaN, Infinity])
		assert.throws(
			() => createBotMachine({ preferences: { idleGazeRadius } }),
			/idleGazeRadius/
		)
})

test('accepting a player goal cancels decorative gaze throughout thinking and execution', async t => {
	const { bot, actor: original, add, looks, tick } = await fixture(t)
	original.stop()
	const actor = createActor(
		original.logic.provide({
			actors: {
				agentThinking: fromPromise(async () => ({
					kind: 'execute' as const,
					execution: {
						toolName: 'navigate_to' as const,
						args: { position: { x: 20, y: 64, z: 0 } }
					},
					subGoal: 'Travel',
					transcript: []
				}))
			}
		}),
		{ input: { bot: bot.asBot() } }
	)
	t.mock.method(bot.hsm, 'getContext', () => actor.getSnapshot().context)
	t.after(() => actor.stop())
	actor.start()
	await flush()
	add('player', -2)
	await tick()
	const before = looks.length
	assert.ok(before > 0)
	actor.send({ type: 'USER_COMMAND', username: 'Steve', text: 'Travel' })
	assert.ok(
		actor.getSnapshot().matches({ MAIN_ACTIVITY: { TASKS: 'THINKING' } })
	)
	bot.emit('physicsTick')
	await flush()
	assert.ok(
		actor
			.getSnapshot()
			.matches({ MAIN_ACTIVITY: { TASKS: { EXECUTING: 'NAVIGATING' } } })
	)
	await tick()
	assert.ok(looks.slice(before).every(call => call.point.x !== -2))
	assert.ok(!actor.getSnapshot().children.idleGaze)
})

test('a stalled native look is bounded and cannot hold idle subscriptions forever', async t => {
	const { bot, actor, add, looks, tick } = await fixture(t)
	let finish = () => {}
	bot.aimGate = new Promise<void>(resolve => {
		finish = resolve
	})
	add('player', 2)
	await tick()
	const before = looks.length
	await tick(2000)
	assert.ok(actor.getSnapshot().matches({ MAIN_ACTIVITY: 'IDLE' }))
	assert.ok(!actor.getSnapshot().children.idleGaze)
	finish()
	await flush()
	await tick()
	assert.equal(looks.length, before)
})

test('invalid head geometry never reaches lookAt, and corrected data can be used', async t => {
	const { bot, add, looks, tick } = await fixture(t)
	const player = add('player', 2)
	Object.assign(player, { eyeHeight: NaN })
	await tick()
	assert.equal(looks.length, 0)
	Object.assign(player, { eyeHeight: 1.62 })
	Object.assign(bot.entity, { eyeHeight: NaN })
	await tick()
	assert.equal(looks.length, 0)
	Object.assign(bot.entity, { eyeHeight: 1.62 })
	await tick()
	assert.ok(looks.length > 0)
})
