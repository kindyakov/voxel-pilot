import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'

import type { Block, Bot } from '@/types/index.js'
import { Vec3 } from 'vec3'
import { createActor, setup } from 'xstate'

import { primitiveBreaking } from '@/hsm/actors/primitives/primitiveBreaking.primitive.js'
import {
	type MiningResource,
	resolveMiningResource
} from '@/hsm/tasks/miningResource.js'
import type { MachineEvent } from '@/hsm/types.js'

import { BlockFactory, ItemFactory, registry } from './fixtures/handoffBot.js'

type BreakingEvent =
	| { type: 'BROKEN' }
	| { type: 'BREAKING_FAILED'; reason: string }
	| { type: 'MINING_TARGET_CHANGED' }
	| { type: 'MINING_TOOL_FAILED'; reason: string }

type BreakingBotOptions = {
	inventory?: Record<number, number>
	equipError?: string | null
	digAddsToInventory?: boolean
	heldItemName?: string | null
	/**
	 * Movement gate: the drop becomes collectible only after the primitive
	 * navigates toward it. Proves BROKEN requires travel, not just calls.
	 */
	pickupRequiresGoal?: boolean
}

class BreakingBotFixture extends EventEmitter {
	readonly registry = registry
	readonly goals: unknown[] = []
	readonly heldItemsAtDig: Array<string | null> = []
	readonly unequipCalls: string[] = []
	private readonly counts: Map<number, number>
	readonly inventory = {
		items: () => [new ItemFactory(registry.itemsByName.iron_pickaxe.id, 1)]
	}
	currentBlock: Block | null = null
	blockAt(): Block | null {
		return this.currentBlock
	}
	async equip(): Promise<void> {}
	heldItem: { name: string } | null
	readonly pathfinder = {
		setGoal: (goal: unknown) => {
			this.goals.push(goal)
		}
	}
	readonly tool = {
		equipForBlock: async () => {
			if (this.options.equipError) {
				throw new Error(this.options.equipError)
			}
		}
	}
	readonly utils = {
		countItemInInventory: (itemId: number) => this.counts.get(itemId) ?? 0,
		waitForInventoryChange: async (itemId: number, initialCount: number) => {
			if (this.options.pickupRequiresGoal && this.goals.length === 0) {
				return false
			}
			if (this.options.pickupRequiresGoal) {
				this.counts.set(itemId, (this.counts.get(itemId) ?? 0) + 1)
			}
			return (this.counts.get(itemId) ?? 0) > initialCount
		}
	}
	readonly hsm = { getContext: () => ({}) }

	constructor(private readonly options: BreakingBotOptions = {}) {
		super()
		this.heldItem = options.heldItemName ? { name: options.heldItemName } : null
		this.counts = new Map<number, number>(
			Object.entries(options.inventory ?? {}).map(([id, count]) => [
				Number(id),
				count
			])
		)
	}

	async dig(): Promise<void> {
		this.heldItemsAtDig.push(this.heldItem?.name ?? null)
		if (this.options.digAddsToInventory) {
			this.counts.set(15, (this.counts.get(15) ?? 0) + 1)
		}
	}

	async unequip(destination: string): Promise<void> {
		this.unequipCalls.push(destination)
		this.heldItem = null
	}

	stopDigging(): void {}

	asBot(): Bot {
		return this as unknown as Bot
	}
}

const createBreakingBot = (options: BreakingBotOptions = {}) =>
	new BreakingBotFixture(options)

const runBreaking = async (
	bot: BreakingBotFixture,
	block: Block | null,
	miningResource?: MiningResource
) => {
	bot.currentBlock = block
	const events: BreakingEvent[] = []
	const machine = setup({
		types: { events: {} as MachineEvent },
		actors: { breaking: primitiveBreaking }
	}).createMachine({
		id: 'breaking-harness',
		initial: 'breaking',
		states: {
			breaking: {
				invoke: {
					src: 'breaking',
					input: { bot: bot.asBot(), options: { block, miningResource } }
				},
				on: {
					MINING_TARGET_CHANGED: {
						target: 'done',
						actions: ({ event }) => {
							events.push(event)
						}
					},
					MINING_TOOL_FAILED: {
						target: 'done',
						actions: ({ event }) => {
							events.push(event)
						}
					},
					BROKEN: {
						target: 'done',
						actions: () => {
							events.push({ type: 'BROKEN' })
						}
					},
					BREAKING_FAILED: {
						target: 'done',
						actions: ({ event }) => {
							events.push({
								type: 'BREAKING_FAILED',
								reason: event.reason ?? 'Unknown breaking failure'
							})
						}
					}
				}
			},
			done: { type: 'final' }
		}
	})

	const actor = createActor(machine)
	actor.start()
	for (let attempt = 0; attempt < 40 && events.length === 0; attempt += 1) {
		await delay(10)
	}
	actor.stop()
	return { events, bot }
}

const oreBlock = (drops: Block['drops'] = [15]): Block => {
	const definition = registry.blocksByName.iron_ore
	assert.ok(definition)
	const block: Block = BlockFactory.fromStateId(definition.minStateId, 0)
	block.position = new Vec3(1, 64, 0)
	block.drops = drops
	return block
}

const resourceBlock = (name: 'sand' | 'cobweb'): Block => {
	const definition = registry.blocksByName[name]
	assert.ok(definition)
	const block: Block = BlockFactory.fromStateId(definition.minStateId, 0)
	block.position = new Vec3(1, 64, 0)
	block.drops = [15]
	return block
}

test('primitiveBreaking fails fast without a block', async () => {
	const { events } = await runBreaking(createBreakingBot(), null)

	assert.equal(events.length, 1)
	assert.equal(events[0]?.type, 'BREAKING_FAILED')
})

test('primitiveBreaking reports BROKEN only on inventory growth', async () => {
	const { events, bot } = await runBreaking(
		createBreakingBot({ digAddsToInventory: true }),
		oreBlock()
	)

	assert.equal(events[0]?.type, 'BROKEN')
	// Navigated to the broken position for pickup, then released the goal.
	assert.ok(bot.goals.length >= 2)
	assert.equal(bot.goals[bot.goals.length - 1], null)
})

test('primitiveBreaking earns BROKEN only after navigating to the drop', async () => {
	const { events, bot } = await runBreaking(
		createBreakingBot({ pickupRequiresGoal: true }),
		oreBlock()
	)

	assert.equal(events[0]?.type, 'BROKEN')
	const firstGoal = bot.goals.find((goal: unknown) => goal !== null)
	assert.ok(firstGoal, 'expected a pickup navigation goal before collection')
	assert.equal(bot.goals[bot.goals.length - 1], null)
})

test('primitiveBreaking reports failure when the drop is not picked up', async () => {
	const { events } = await runBreaking(
		createBreakingBot({ digAddsToInventory: false }),
		oreBlock()
	)

	assert.equal(events.length, 1)
	const event = events[0]
	assert.equal(event?.type, 'BREAKING_FAILED')
	if (event?.type === 'BREAKING_FAILED') {
		assert.match(event.reason, /not collected/i)
	}
})

test('primitiveBreaking skips pickup for blocks without drops', async () => {
	let waited = false
	const bot = createBreakingBot({ digAddsToInventory: false })
	bot.utils.waitForInventoryChange = async () => {
		waited = true
		return true
	}

	const { events } = await runBreaking(bot, oreBlock([]))

	assert.equal(events[0]?.type, 'BROKEN')
	assert.equal(waited, false)
})

test('primitiveBreaking names a missing harvest tool', async () => {
	const { events } = await runBreaking(
		createBreakingBot({ equipError: 'Cannot harvest without tool' }),
		oreBlock()
	)

	assert.equal(events[0]?.type, 'BREAKING_FAILED')
	const event = events[0]
	if (event?.type === 'BREAKING_FAILED') {
		assert.match(event.reason, /No harvest tool for iron_ore/)
	}
})

test('primitiveBreaking unequips a sword before mining sand without a shovel', async () => {
	const { events, bot } = await runBreaking(
		createBreakingBot({
			heldItemName: 'iron_sword',
			digAddsToInventory: true
		}),
		resourceBlock('sand')
	)

	assert.equal(events[0]?.type, 'BROKEN')
	assert.deepEqual(bot.unequipCalls, ['hand'])
	assert.deepEqual(bot.heldItemsAtDig, [null])
})

test('primitiveBreaking keeps a sword equipped for cobweb', async () => {
	const { events, bot } = await runBreaking(
		createBreakingBot({
			heldItemName: 'iron_sword',
			digAddsToInventory: true
		}),
		resourceBlock('cobweb')
	)

	assert.equal(events[0]?.type, 'BROKEN')
	assert.deepEqual(bot.unequipCalls, [])
	assert.deepEqual(bot.heldItemsAtDig, ['iron_sword'])
})

test('mining rechecks the target after asynchronous equipment and never digs its replacement', async () => {
	const bot = createBreakingBot()
	bot.equip = async () => {
		bot.currentBlock = resourceBlock('sand')
	}
	const { events } = await runBreaking(
		bot,
		oreBlock(),
		resolveMiningResource({ registry }, 'iron_ore', 'raw_iron')
	)
	assert.deepEqual(events, [{ type: 'MINING_TARGET_CHANGED' }])
	assert.deepEqual(bot.heldItemsAtDig, [])
})

test('mining rejects a missing target before equipping', async () => {
	const bot = createBreakingBot()
	bot.blockAt = () => null
	let equipped = false
	bot.equip = async () => {
		equipped = true
	}
	const { events } = await runBreaking(
		bot,
		oreBlock(),
		resolveMiningResource({ registry }, 'iron_ore', 'raw_iron')
	)
	assert.deepEqual(events, [{ type: 'MINING_TARGET_CHANGED' }])
	assert.equal(equipped, false)
	assert.deepEqual(bot.heldItemsAtDig, [])
})

test('exact ore blocks fail without Silk Touch, with a specific reason', async () => {
	const bot = createBreakingBot()
	const { events } = await runBreaking(
		bot,
		oreBlock(),
		resolveMiningResource({ registry }, 'iron_ore', 'iron_ore')
	)
	assert.equal(events[0]?.type, 'MINING_TOOL_FAILED')
	if (events[0]?.type === 'MINING_TOOL_FAILED')
		assert.match(events[0].reason, /Silk Touch required/)
	assert.deepEqual(bot.heldItemsAtDig, [])
})
