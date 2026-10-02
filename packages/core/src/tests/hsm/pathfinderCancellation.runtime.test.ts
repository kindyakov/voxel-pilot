import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import test from 'node:test'
import { setImmediate as flush } from 'node:timers/promises'

import pathfinderPackage from 'mineflayer-pathfinder'
import { Vec3 } from 'vec3'

import type { Bot } from '@/types/index.js'

import {
	BlockFactory,
	HandoffBot,
	ItemFactory,
	createHarness,
	registry
} from './fixtures/handoffBot.js'

const require = createRequire(import.meta.url)
const { goals } = pathfinderPackage
const loadGenericPlace: (
	bot: Bot
) => void = require('mineflayer/lib/plugins/generic_place')
const loadPlaceBlock: (
	bot: Bot
) => void = require('mineflayer/lib/plugins/place_block')

const installNativePlacement = (bot: HandoffBot) => {
	const packets: { location: Vec3; direction: number }[] = []
	Object.assign(bot, {
		supportFeature: (feature: string) => bot.registry.supportFeature(feature),
		swingArm: () => {}
	})
	Object.assign(bot._client, {
		write: (name: string, packet: { location: Vec3; direction: number }) => {
			if (name === 'block_place') packets.push(packet)
		}
	})
	loadGenericPlace(bot.asBot())
	loadPlaceBlock(bot.asBot())
	return packets
}

const acknowledgePlacement = (
	bot: HandoffBot,
	packet: { location: Vec3; direction: number }
) => {
	assert.equal(packet.direction, 5)
	const destination = packet.location.offset(1, 0, 0)
	const oldBlock = bot.blockAt(destination)
	const placedBlock = BlockFactory.fromStateId(
		registry.blocksByName.cobblestone.minStateId,
		0
	)
	placedBlock.position = destination
	bot.emit(
		`blockUpdate:${packet.location}`,
		bot.blockAt(packet.location),
		bot.blockAt(packet.location)
	)
	bot.emit(`blockUpdate:${destination}`, oldBlock, placedBlock)
}

test('a synchronous route failure cannot restore the canceled approach after HSM stops it', async t => {
	t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] })
	const { bot, actor, enemy, observe, step } = createHarness()
	t.after(() => actor.stop())
	actor.getSnapshot().context.preferences.approachRouteAttempts = 1
	bot.movements.canDig = false
	bot.movements.allowParkour = false
	bot.movements.scafoldingBlocks = []
	bot.solidAt = position =>
		position.y < 64 &&
		position.x >= -2 &&
		position.x < 4 &&
		position.z >= -2 &&
		position.z < 3
	enemy.position.x = 7
	observe()
	await flush()
	t.mock.timers.tick(500)
	await flush()
	bot.emit('physicsTick')
	await flush()
	assert.ok(
		actor.getSnapshot().matches({ MAIN_ACTIVITY: { COMBAT: 'WAITING' } })
	)
	assert.equal(bot.pathfinder.goal, null)
	assert.equal(
		bot.pathfinder.isMoving(),
		false,
		'The canceled partial approach must not be restored'
	)
	assert.equal(bot.controlState.forward, false)

	// A passable escape still works after the canceled route has released control.
	bot.solidAt = position => position.y < 64
	actor.send({ type: 'UPDATE_HEALTH', health: 8 })
	await flush()
	t.mock.timers.tick(100)
	await flush()
	const before = bot.entity.position.distanceTo(enemy.position)
	for (let tick = 0; tick < 20; tick++) {
		step()
		await flush()
	}
	assert.ok(bot.entity.position.distanceTo(enemy.position) > before + 2)
})

for (const alreadyAtGoal of [true, false]) {
	test(`a goal-reached callback preserves its replacement route (already at goal: ${alreadyAtGoal})`, async t => {
		const { bot, actor, step } = createHarness()
		t.after(() => actor.stop())
		actor.stop()
		const replacement = new goals.GoalBlock(-8, 64, 0)
		let reached = false
		bot.once('goal_reached', () => {
			reached = true
			bot.pathfinder.setGoal(replacement)
		})
		bot.pathfinder.setGoal(new goals.GoalBlock(alreadyAtGoal ? 0 : 2, 64, 0))
		for (let tick = 0; !reached && tick < 80; tick++) {
			step()
			await flush()
		}
		assert.ok(reached, 'The original route must actually complete')
		assert.equal(bot.pathfinder.goal, replacement)
		const before = bot.entity.position.x
		for (let tick = 0; tick < 20; tick++) {
			step()
			await flush()
		}
		assert.ok(
			bot.entity.position.x < before - 2,
			'The replacement route must move the bot'
		)
		bot.pathfinder.setGoal(null)
	})
}

test('native placement waiting for aim is canceled before its packet and a fresh placement still succeeds', async t => {
	t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] })
	const { bot, actor, enemy, observe } = createHarness()
	t.after(() => actor.stop())
	const packets = installNativePlacement(bot)
	bot.solidAt = position => position.y < 64 && Math.floor(position.x) !== 1
	bot.movements.allowParkour = false
	bot.movements.canDig = false
	Object.assign(bot.pathfinder, { LOSWhenPlacingBlocks: false })
	bot.inventory.items = () => [
		new ItemFactory(registry.itemsByName.cobblestone.id, 16),
		new ItemFactory(registry.itemsByName.iron_sword.id, 1)
	]
	enemy.position.x = 5
	observe()
	await flush()
	t.mock.timers.tick(500)
	await flush()
	let finishAim = () => {}
	bot.aimGate = new Promise<void>(resolve => {
		finishAim = resolve
	})
	bot.emit('physicsTick')
	await flush()
	assert.equal(bot.pathfinder.isBuilding(), true)
	assert.ok(bot.equippedItems.includes('cobblestone'))
	assert.equal(packets.length, 0, 'Native placement must be waiting for aim')
	actor.send({ type: 'UPDATE_HEALTH', health: 8 })
	await flush()
	t.mock.timers.tick(100)
	await flush()
	assert.equal(
		bot.controlState.forward,
		true,
		'Escape starts before old aim completes'
	)
	finishAim()
	await flush()
	assert.equal(
		packets.length,
		0,
		'The canceled placement must never send block_place'
	)
	assert.equal(
		bot
			.eventNames()
			.some(
				name => typeof name === 'string' && name.startsWith('blockUpdate:')
			),
		false
	)

	actor.stop()
	bot.aimGate = Promise.resolve()
	bot.pathfinder.setGoal(new goals.GoalBlock(5, 64, 0))
	bot.emit('physicsTick')
	await flush()
	assert.equal(
		packets.length,
		1,
		'A new route must still be able to place blocks'
	)
	const packet = packets[0]!
	acknowledgePlacement(bot, packet)
	await flush()
	assert.equal(bot.pathfinder.isBuilding(), false)
	assert.equal(
		bot
			.eventNames()
			.some(
				name => typeof name === 'string' && name.startsWith('blockUpdate:')
			),
		false
	)
	bot.pathfinder.setGoal(null)
})

test('canceling a placement response detaches its observers and preserves a fresh placement', async t => {
	t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] })
	const { bot, actor } = createHarness()
	t.after(() => actor.stop())
	actor.stop()
	const packets = installNativePlacement(bot)
	bot.inventory.slots[36] = new ItemFactory(
		registry.itemsByName.cobblestone.id,
		16
	)
	const reference = bot.blockAt(new Vec3(0, 63, 0))
	const controller = new AbortController()
	const canceled = bot
		.asBot()
		._placeBlockWithOptions(reference, new Vec3(1, 0, 0), {
			signal: controller.signal
		})
	const rejection = assert.rejects(canceled, /Canceled placement response/)
	await flush()
	assert.equal(packets.length, 1)
	controller.abort(new Error('Canceled placement response'))
	await rejection
	await flush()
	assert.equal(
		bot
			.eventNames()
			.some(
				name => typeof name === 'string' && name.startsWith('blockUpdate:')
			),
		false
	)

	const fresh = bot
		.asBot()
		._placeBlockWithOptions(reference, new Vec3(1, 0, 0), {
			signal: new AbortController().signal
		})
	await flush()
	assert.equal(packets.length, 2)
	acknowledgePlacement(bot, packets[1]!)
	await fresh
	await flush()
	assert.equal(
		bot
			.eventNames()
			.some(
				name => typeof name === 'string' && name.startsWith('blockUpdate:')
			),
		false
	)
})

test('native gate activation respects cancellation after aim and still permits a new activation', async () => {
	const bot = new HandoffBot()
	const packets = installNativePlacement(bot)
	const loadInventory: (
		bot: Bot,
		options: { hideErrors: boolean }
	) => void = require('mineflayer/lib/plugins/inventory')
	loadInventory(bot.asBot(), { hideErrors: true })
	const controller = new AbortController()
	let finishAim = () => {}
	bot.aimGate = new Promise<void>(resolve => {
		finishAim = resolve
	})
	const gate = BlockFactory.fromProperties(
		registry.blocksByName.oak_fence_gate.id,
		{ open: false },
		0
	)
	gate.position = new Vec3(1, 64, 0)
	const activation = bot
		.asBot()
		.activateBlock(gate, undefined, undefined, { signal: controller.signal })
	const rejection = assert.rejects(activation, /Gate activation canceled/)
	await flush()
	controller.abort(new Error('Gate activation canceled'))
	finishAim()
	await rejection
	assert.equal(packets.length, 0)
	bot.aimGate = Promise.resolve()
	await bot.asBot().activateBlock(gate, undefined, undefined, {
		signal: new AbortController().signal
	})
	assert.equal(packets.length, 1)
})
