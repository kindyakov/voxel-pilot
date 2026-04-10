import assert from 'node:assert/strict'
import test from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import { createActor, createMachine } from 'xstate'
import { Vec3 } from 'vec3'

import { primitiveSearchBlock } from '../../hsm/actors/primitives/primitiveSearchBlock.primitive.js'

type SearchBlockOptions = {
	blockName: string
	maxDistance?: number
	count?: number
	mode?: 'simple' | 'mining'
	maxYDiffAbove?: number
	maxYDiffBelow?: number
	prioritizeSafety?: boolean
}

type SearchBlockEvent =
	| {
			type: 'BLOCKS_FOUND'
			blocks: Array<{ position: Vec3; block: { name: string } }>
	  }
	| {
			type: 'NOT_FOUND'
			reason: string
	  }

type FakeBlock = {
	name: string
	position: Vec3
	drops?: unknown[]
}

class FakeBot {
	public entity = {
		position: new Vec3(0, 64, 0)
	}

	public registry = {
		blocksByName: {} as Record<string, { id: number }>
	}

	public hsm = {
		getContext: () => ({})
	}

	public readonly findBlocksCalls: Array<{
		matching: number
		maxDistance: number
		count: number
	}> = []

	private readonly blocksByPosition = new Map<string, FakeBlock>()

	constructor(
		blocksByName: Record<string, number>,
		blocks: Array<{ name: string; position: Vec3; support?: FakeBlock | null }>
	) {
		this.registry.blocksByName = Object.fromEntries(
			Object.entries(blocksByName).map(([name, id]) => [name, { id }])
		)

		for (const block of blocks) {
			this.blocksByPosition.set(this.key(block.position), {
				name: block.name,
				position: block.position,
				drops: []
			})

			if (block.support) {
				this.blocksByPosition.set(
					this.key(
						new Vec3(
							block.position.x,
							block.position.y - 1,
							block.position.z
						)
					),
					block.support
				)
			}
		}
	}

	public on() {}

	public off() {}

	public findBlocks = (query: { matching: number; maxDistance: number; count: number }) => {
		this.findBlocksCalls.push(query)
		return [...this.blocksByPosition.values()]
			.filter(block => block.position.y >= Number.NEGATIVE_INFINITY)
			.map(block => block.position)
	}

	public blockAt = (position: Vec3) => this.blocksByPosition.get(this.key(position)) ?? null

	private key(position: Vec3) {
		return `${position.x}:${position.y}:${position.z}`
	}
}

const createSearchBot = (params: {
	blocksByName: Record<string, number>
	blocks: Array<{ name: string; position: Vec3; support?: FakeBlock | null }>
}) => new FakeBot(params.blocksByName, params.blocks) as any

const runSearch = async (bot: FakeBot, options: SearchBlockOptions) => {
	const events: SearchBlockEvent[] = []

	const machine = createMachine({
		id: 'search-block-harness',
		initial: 'searching',
		states: {
			searching: {
				invoke: {
					src: primitiveSearchBlock,
					input: {
						bot,
						options
					}
				},
				on: {
					BLOCKS_FOUND: {
						target: 'done',
						actions: ({ event }) => {
							events.push(event as SearchBlockEvent)
						}
					},
					NOT_FOUND: {
						target: 'done',
						actions: ({ event }) => {
							events.push(event as SearchBlockEvent)
						}
					}
				}
			},
			done: {
				type: 'final'
			}
		}
	})

	const actor = createActor(machine)
	bot.hsm = {
		getContext: () => actor.getSnapshot().context
	}

	actor.start()

	for (let attempt = 0; attempt < 20 && events.length === 0; attempt += 1) {
		await delay(10)
	}

	return {
		actor,
		events
	}
}

test('primitiveSearchBlock emits NOT_FOUND for an unknown block name', async () => {
	const bot = createSearchBot({
		blocksByName: {},
		blocks: []
	})

	const { events } = await runSearch(bot, {
		blockName: 'diamond_ore'
	})

	assert.equal(events.length, 1)
	const notFoundEvent = events[0]

	if (!notFoundEvent || notFoundEvent.type !== 'NOT_FOUND') {
		throw new Error('Expected a NOT_FOUND event')
	}

	assert.equal(notFoundEvent.reason, 'Unknown block type: diamond_ore')
})

test('primitiveSearchBlock emits the nearest block in simple mode', async () => {
	const nearest = new Vec3(1, 64, 0)
	const farther = new Vec3(4, 64, 0)

	const bot = createSearchBot({
		blocksByName: {
			stone: 1
		},
		blocks: [
			{
				name: 'stone',
				position: farther
			},
			{
				name: 'stone',
				position: nearest
			}
		]
	})

	const { events } = await runSearch(bot, {
		blockName: 'stone',
		maxDistance: 32,
		mode: 'simple'
	})

	assert.equal(bot.findBlocksCalls.length, 1)
	assert.equal(bot.findBlocksCalls[0]?.count, 100)
	assert.equal(events.length, 1)
	const foundEvent = events[0]

	if (!foundEvent || foundEvent.type !== 'BLOCKS_FOUND') {
		throw new Error('Expected a BLOCKS_FOUND event')
	}

	assert.equal(foundEvent.blocks.length, 1)
	assert.equal(foundEvent.blocks[0]?.position, nearest)
})

test('primitiveSearchBlock applies mining y filtering and count limits', async () => {
	const best = new Vec3(0, 65, 0)
	const second = new Vec3(1, 64, 0)
	const excludedByY = new Vec3(0, 71, 0)
	const lowerPriority = new Vec3(0, 63, 0)

	const bot = createSearchBot({
		blocksByName: {
			stone: 1
		},
		blocks: [
			{
				name: 'stone',
				position: lowerPriority
			},
			{
				name: 'stone',
				position: excludedByY
			},
			{
				name: 'stone',
				position: second
			},
			{
				name: 'stone',
				position: best
			}
		]
	})

	const { events } = await runSearch(bot, {
		blockName: 'stone',
		count: 2,
		mode: 'mining'
	})

	assert.equal(bot.findBlocksCalls.length, 1)
	assert.equal(bot.findBlocksCalls[0]?.count, 100)
	assert.equal(events.length, 1)
	const miningEvent = events[0]

	if (!miningEvent || miningEvent.type !== 'BLOCKS_FOUND') {
		throw new Error('Expected a BLOCKS_FOUND event')
	}

	assert.equal(miningEvent.blocks.length, 2)
	assert.equal(miningEvent.blocks[0]?.position, second)
	assert.equal(miningEvent.blocks[1]?.position, best)
	assert.equal(
		miningEvent.blocks.some(block => block.position === excludedByY),
		false
	)
})
