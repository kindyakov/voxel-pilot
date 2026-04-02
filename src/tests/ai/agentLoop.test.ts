import assert from 'node:assert/strict'
import test from 'node:test'

import { OpenAIResponsesClient } from '../../ai/client.js'
import { runAgentTurn } from '../../ai/loop.js'
import { createTaskContext } from '../../ai/taskContext.js'

const createVec3 = (x: number, y: number, z: number) => ({
	x,
	y,
	z,
	distanceTo(other: { x: number; y: number; z: number }) {
		const dx = x - other.x
		const dy = y - other.y
		const dz = z - other.z
		return Math.sqrt(dx * dx + dy * dy + dz * dz)
	}
})

test('runAgentTurn resolves inline memory tool calls before selecting one execution action', async () => {
	const responses = [
		{
			id: 'resp_1',
			output: [
				{
					type: 'function_call',
					call_id: 'call_1',
					name: 'memory_read',
					arguments: JSON.stringify({
						query_tags: ['crafting_table'],
						max_distance: 100
					})
				}
			]
		},
		{
			id: 'resp_2',
			output: [
				{
					type: 'function_call',
					call_id: 'call_2',
					name: 'navigate_to',
					arguments: JSON.stringify({
						position: {
							x: 12,
							y: 64,
							z: -4
						},
						range: 2
					})
				}
			]
		}
	]

	const client = new OpenAIResponsesClient({
		client: {
			responses: {
				create: async () => responses.shift() as any
			}
		},
		model: 'test-model'
	})

	const memoryEntries = [
		{
			id: 'entry_1',
			type: 'container',
			position: { x: 12, y: 64, z: -4 },
			tags: ['crafting_table'],
			description: 'Workbench',
			data: {},
			updatedAt: Date.now()
		}
	]

	const memory = {
		readEntries: () => memoryEntries,
		saveEntry: () => memoryEntries[0],
		updateEntryData: () => null,
		deleteEntry: () => false
	} as any

	const bot = {
		memory,
		health: 20,
		food: 20,
		oxygenLevel: 20,
		entity: { position: createVec3(0, 64, 0) },
		game: { dimension: 'overworld' },
		time: { isDay: true, timeOfDay: 1000 },
		inventory: {
			slots: Array.from({ length: 46 }, () => null),
			items: () => []
		},
		getEquipmentDestSlot: () => 36,
		blockAt: () => null,
		findBlocks: () => [],
		entities: {},
		closeWindow: () => {}
	} as any

	const result = await runAgentTurn({
		bot,
		memory,
		currentGoal: 'Use the crafting table',
		subGoal: null,
		lastAction: null,
		lastResult: null,
		lastReason: null,
		errorHistory: [],
		taskContext: createTaskContext('Use the crafting table', null),
		client
	})

	assert.equal(result.kind, 'execute')
	if (result.kind !== 'execute') {
		assert.fail('Expected execution result')
	}
	assert.equal(result.execution.toolName, 'navigate_to')
	assert.deepEqual(result.execution.args, {
		position: { x: 12, y: 64, z: -4 },
		range: 2
	})
	assert.equal(result.transcript[1]!, 'memory_read')
	assert.equal(result.transcript[3]!, 'navigate_to')
	assert.match(result.transcript[0]!, /^round_0_ms:\d+$/)
	assert.match(result.transcript[2]!, /^round_1_ms:\d+$/)
})

test('runAgentTurn rejects navigation to unsupported workstation for crafting goals', async () => {
	const client = new OpenAIResponsesClient({
		client: {
			responses: {
				create: async () =>
					({
						id: 'resp_1',
						output: [
							{
								type: 'function_call',
								call_id: 'call_1',
								name: 'navigate_to',
								arguments: JSON.stringify({
									position: {
										x: 2,
										y: 64,
										z: 0
									}
								})
							}
						]
					}) as any
			}
		},
		model: 'test-model'
	})

	const memory = {
		readEntries: () => [],
		saveEntry: () => null,
		updateEntryData: () => null,
		deleteEntry: () => false
	} as any

	const bot = {
		memory,
		health: 20,
		food: 20,
		oxygenLevel: 20,
		entity: { position: createVec3(0, 64, 0) },
		game: { dimension: 'overworld' },
		time: { isDay: true, timeOfDay: 1000 },
		inventory: {
			slots: Array.from({ length: 46 }, () => null),
			items: () => []
		},
		getEquipmentDestSlot: () => 36,
		blockAt: (position: { x: number; y: number; z: number }) =>
			position.x === 2 && position.y === 64 && position.z === 0
				? {
						name: 'stonecutter',
						position: createVec3(2, 64, 0)
					}
				: null,
		findBlocks: () => [],
		entities: {},
		closeWindow: () => {}
	} as any

	const result = await runAgentTurn({
		bot,
		memory,
		currentGoal: 'craft an axe',
		subGoal: null,
		lastAction: null,
		lastResult: null,
		lastReason: null,
		errorHistory: [],
		taskContext: createTaskContext('craft an axe', null),
		client
	})

	assert.equal(result.kind, 'failed')
	if (result.kind !== 'failed') {
		assert.fail('Expected failed result')
	}
	assert.match(
		result.reason,
		/unsupported workstation for crafting tasks/i
	)
})

test('runAgentTurn still fails when the first model response is plain text without any tool call', async () => {
	const client = new OpenAIResponsesClient({
		client: {
			responses: {
				create: async () =>
					({
						id: 'resp_plain_text',
						output_text: 'В моем инвентаре есть кирка и еда.',
						output: []
					}) as any
			}
		},
		model: 'test-model'
	})

	const memory = {
		readEntries: () => [],
		saveEntry: () => null,
		updateEntryData: () => null,
		deleteEntry: () => false
	} as any

	const bot = {
		memory,
		health: 20,
		food: 20,
		oxygenLevel: 20,
		entity: { position: createVec3(0, 64, 0) },
		game: { dimension: 'overworld' },
		time: { isDay: true, timeOfDay: 1000 },
		inventory: {
			slots: Array.from({ length: 46 }, () => null),
			items: () => []
		},
		getEquipmentDestSlot: () => 36,
		blockAt: () => null,
		findBlocks: () => [],
		entities: {},
		closeWindow: () => {}
	} as any

	const result = await runAgentTurn({
		bot,
		memory,
		currentGoal: 'Что у тебя в инвентаре?',
		subGoal: null,
		lastAction: null,
		lastResult: null,
		lastReason: null,
		errorHistory: [],
		taskContext: createTaskContext('Что у тебя в инвентаре?', null),
		client
	})

	assert.equal(result.kind, 'failed')
	if (result.kind !== 'failed') {
		assert.fail('Expected failed result')
	}
	assert.equal(result.reason, 'Model did not return a tool call')
	assert.match(result.transcript[0]!, /^round_0_ms:\d+$/)
	assert.match(result.transcript[1]!, /^round_1_ms:\d+$/)
})

test('runAgentTurn still fails when the model returns no tool call and no plain-text response', async () => {
	const responses = [
		{
			id: 'resp_empty_1',
			output: []
		},
		{
			id: 'resp_empty_2',
			output: []
		}
	]

	const client = new OpenAIResponsesClient({
		client: {
			responses: {
				create: async () => responses.shift() as any
			}
		},
		model: 'test-model'
	})

	const memory = {
		readEntries: () => [],
		saveEntry: () => null,
		updateEntryData: () => null,
		deleteEntry: () => false
	} as any

	const bot = {
		memory,
		health: 20,
		food: 20,
		oxygenLevel: 20,
		entity: { position: createVec3(0, 64, 0) },
		game: { dimension: 'overworld' },
		time: { isDay: true, timeOfDay: 1000 },
		inventory: {
			slots: Array.from({ length: 46 }, () => null),
			items: () => []
		},
		getEquipmentDestSlot: () => 36,
		blockAt: () => null,
		findBlocks: () => [],
		entities: {},
		closeWindow: () => {}
	} as any

	const result = await runAgentTurn({
		bot,
		memory,
		currentGoal: 'Что у тебя в инвентаре?',
		subGoal: null,
		lastAction: null,
		lastResult: null,
		lastReason: null,
		errorHistory: [],
		taskContext: createTaskContext('Что у тебя в инвентаре?', null),
		client
	})

	assert.equal(result.kind, 'failed')
	if (result.kind !== 'failed') {
		assert.fail('Expected failed result')
	}
	assert.equal(result.reason, 'Model did not return a tool call')
	assert.match(result.transcript[0]!, /^round_0_ms:\d+$/)
	assert.match(result.transcript[1]!, /^round_1_ms:\d+$/)
})

test('runAgentTurn accepts plain-text finish after an inline tool round grounded the response', async () => {
	const responses = [
		{
			id: 'resp_1',
			output: [
				{
					type: 'function_call',
					call_id: 'call_1',
					name: 'inspect_inventory',
					arguments: JSON.stringify({})
				}
			]
		},
		{
			id: 'resp_2',
			output_text: 'В моем инвентаре есть кирка и еда.',
			output: []
		}
	]

	const client = new OpenAIResponsesClient({
		client: {
			responses: {
				create: async () => responses.shift() as any
			}
		},
		model: 'test-model'
	})

	const memory = {
		readEntries: () => [],
		saveEntry: () => null,
		updateEntryData: () => null,
		deleteEntry: () => false
	} as any

	const bot = {
		memory,
		health: 20,
		food: 20,
		oxygenLevel: 20,
		entity: { position: createVec3(0, 64, 0) },
		game: { dimension: 'overworld' },
		time: { isDay: true, timeOfDay: 1000 },
		inventory: {
			slots: Array.from({ length: 46 }, (_, index) =>
				index === 36 ? { name: 'iron_pickaxe', count: 1, durabilityUsed: 5 } : null
			),
			items: () => [{ name: 'iron_pickaxe', count: 1, durabilityUsed: 5 }]
		},
		getEquipmentDestSlot: () => 36,
		blockAt: () => null,
		findBlocks: () => [],
		entities: {},
		closeWindow: () => {}
	} as any

	const result = await runAgentTurn({
		bot,
		memory,
		currentGoal: 'Что у тебя в инвентаре?',
		subGoal: null,
		lastAction: null,
		lastResult: null,
		lastReason: null,
		errorHistory: [],
		taskContext: createTaskContext('Что у тебя в инвентаре?', null),
		client
	})

	assert.equal(result.kind, 'finish')
	if (result.kind !== 'finish') {
		assert.fail('Expected finish result')
	}
	assert.equal(result.message, 'В моем инвентаре есть кирка и еда.')
	assert.match(result.transcript[0]!, /^round_0_ms:\d+$/)
	assert.equal(result.transcript[1]!, 'inspect_inventory')
	assert.match(result.transcript[2]!, /^round_1_ms:\d+$/)
})
