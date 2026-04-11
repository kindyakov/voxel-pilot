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

test('runAgentTurn accepts mine_resource without a grounded block position', async () => {
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
								name: 'mine_resource',
								arguments: JSON.stringify({
									block_name: 'iron_ore',
									count: 2
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
		blockAt: () => null,
		findBlocks: () => [],
		entities: {},
		closeWindow: () => {}
	} as any

	const result = await runAgentTurn({
		bot,
		memory,
		currentGoal: 'Mine 2 iron ore',
		subGoal: null,
		lastAction: null,
		lastResult: null,
		lastReason: null,
		errorHistory: [],
		taskContext: createTaskContext('Mine 2 iron ore', null),
		client
	})

	assert.equal(result.kind, 'execute')
	if (result.kind !== 'execute') {
		assert.fail('Expected execution result')
	}
	assert.equal(result.execution.toolName, 'mine_resource')
	assert.deepEqual(result.execution.args, {
		block_name: 'iron_ore',
		count: 2
	})
})

test('runAgentTurn rejects mine_resource with non-integer or excessive count', async () => {
	for (const count of [1.5, 1000000]) {
		const client = new OpenAIResponsesClient({
			client: {
				responses: {
					create: async () =>
						({
							id: `resp_${count}`,
							output: [
								{
									type: 'function_call',
									call_id: 'call_1',
									name: 'mine_resource',
									arguments: JSON.stringify({
										block_name: 'iron_ore',
										count
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
			blockAt: () => null,
			findBlocks: () => [],
			entities: {},
			closeWindow: () => {}
		} as any

		const result = await runAgentTurn({
			bot,
			memory,
			currentGoal: 'Mine iron ore',
			subGoal: null,
			lastAction: null,
			lastResult: null,
			lastReason: null,
			errorHistory: [],
			taskContext: createTaskContext('Mine iron ore', null),
			client
		})

		assert.equal(result.kind, 'failed')
		if (result.kind !== 'failed') {
			assert.fail('Expected failed result')
		}
		assert.match(result.reason, /integer count from 1 to 64/)
	}
})

test('runAgentTurn rejects open_window when memory_read returns no grounded entries', async () => {
	const responses = [
		{
			id: 'resp_1',
			output: [
				{
					type: 'function_call',
					call_id: 'call_1',
					name: 'memory_read',
					arguments: JSON.stringify({
						query_tags: ['furnace'],
						max_distance: 32
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
					name: 'open_window',
					arguments: JSON.stringify({
						position: {
							x: 4,
							y: 64,
							z: 4
						}
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
		currentGoal: 'Open the nearby furnace',
		subGoal: null,
		lastAction: null,
		lastResult: null,
		lastReason: null,
		errorHistory: [],
		taskContext: createTaskContext('Open the nearby furnace', null),
		client
	})

	assert.equal(result.kind, 'failed')
	if (result.kind !== 'failed') {
		assert.fail('Expected failed result')
	}
	assert.match(
		result.reason,
		/open_window.*requires a window-compatible position grounded/i
	)
})

test('runAgentTurn accepts open_window only from allowed grounding sources', async () => {
	const responses = [
		{
			id: 'resp_1',
			output: [
				{
					type: 'function_call',
					call_id: 'call_1',
					name: 'memory_read',
					arguments: JSON.stringify({
						query_tags: ['furnace'],
						max_distance: 32
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
					name: 'open_window',
					arguments: JSON.stringify({
						position: {
							x: 4,
							y: 64,
							z: 4
						}
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
			position: { x: 4, y: 64, z: 4 },
			tags: ['furnace'],
			description: 'Furnace',
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
		currentGoal: 'Open the nearby furnace',
		subGoal: null,
		lastAction: null,
		lastResult: null,
		lastReason: null,
		errorHistory: [],
		taskContext: createTaskContext('Open the nearby furnace', null),
		client
	})

	assert.equal(result.kind, 'execute')
	if (result.kind !== 'execute') {
		assert.fail('Expected execution result')
	}
	assert.equal(result.execution.toolName, 'open_window')
	assert.deepEqual(result.execution.args, {
		position: { x: 4, y: 64, z: 4 }
	})
})

test('runAgentTurn rejects open_window when memory_read grounds an incompatible location entry', async () => {
	const responses = [
		{
			id: 'resp_1',
			output: [
				{
					type: 'function_call',
					call_id: 'call_1',
					name: 'memory_read',
					arguments: JSON.stringify({
						query_tags: ['oak_tree'],
						max_distance: 32
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
					name: 'open_window',
					arguments: JSON.stringify({
						position: {
							x: 8,
							y: 64,
							z: 8
						}
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
			type: 'location',
			position: { x: 8, y: 64, z: 8 },
			tags: ['oak_tree'],
			description: 'Oak tree',
			data: {
				kind: 'resource'
			},
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
		currentGoal: 'Open the nearby furnace',
		subGoal: null,
		lastAction: null,
		lastResult: null,
		lastReason: null,
		errorHistory: [],
		taskContext: createTaskContext('Open the nearby furnace', null),
		client
	})

	assert.equal(result.kind, 'failed')
	if (result.kind !== 'failed') {
		assert.fail('Expected failed result')
	}
	assert.match(
		result.reason,
		/open_window.*requires a window-compatible position grounded/i
	)
})

test('runAgentTurn rejects follow_entity when inspect_entities returns no entities', async () => {
	const responses = [
		{
			id: 'resp_1',
			output: [
				{
					type: 'function_call',
					call_id: 'call_1',
					name: 'inspect_entities',
					arguments: JSON.stringify({
						max_distance: 32,
						max_results: 8
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
					name: 'follow_entity',
					arguments: JSON.stringify({
						entity_name: 'Steve',
						distance: 2
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
		currentGoal: 'Follow Steve',
		subGoal: null,
		lastAction: null,
		lastResult: null,
		lastReason: null,
		errorHistory: [],
		taskContext: createTaskContext('Follow Steve', null),
		client
	})

	assert.equal(result.kind, 'failed')
	if (result.kind !== 'failed') {
		assert.fail('Expected failed result')
	}
	assert.match(
		result.reason,
		/follow_entity.*entity_name.*not grounded by inspect_entities/i
	)
})

test('runAgentTurn rejects follow_entity when entity_name and entity_type do not describe the same grounded entity', async () => {
	const responses = [
		{
			id: 'resp_1',
			output: [
				{
					type: 'function_call',
					call_id: 'call_1',
					name: 'inspect_entities',
					arguments: JSON.stringify({
						max_distance: 32,
						max_results: 8
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
					name: 'follow_entity',
					arguments: JSON.stringify({
						entity_name: 'Steve',
						entity_type: 'cow',
						distance: 2
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
		entities: {
			'1': {
				id: 1,
				username: 'Steve',
				name: 'player',
				type: 'player',
				position: createVec3(2, 64, 0),
				height: 1.8
			},
			'2': {
				id: 2,
				username: 'Betsy',
				name: 'cow',
				type: 'cow',
				position: createVec3(4, 64, 0),
				height: 1.4
			}
		},
		closeWindow: () => {}
	} as any

	const result = await runAgentTurn({
		bot,
		memory,
		currentGoal: 'Follow Steve the cow',
		subGoal: null,
		lastAction: null,
		lastResult: null,
		lastReason: null,
		errorHistory: [],
		taskContext: createTaskContext('Follow Steve the cow', null),
		client
	})

	assert.equal(result.kind, 'failed')
	if (result.kind !== 'failed') {
		assert.fail('Expected failed result')
	}
	assert.match(
		result.reason,
		/follow_entity.*to refer to the same grounded entity fact/i
	)
})

test('runAgentTurn does not treat snapshot window metadata as fresh grounding', async () => {
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
								name: 'open_window',
								arguments: JSON.stringify({
									position: {
										x: 1,
										y: 64,
										z: 1
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
		blockAt: () => null,
		findBlocks: () => [],
		entities: {},
		closeWindow: () => {}
	} as any

	const result = await runAgentTurn({
		bot,
		memory,
		currentGoal: 'Re-open that window',
		subGoal: null,
		lastAction: 'inspect_window',
		lastResult: 'SUCCESS',
		lastReason: null,
		errorHistory: [],
		taskContext: createTaskContext('Re-open that window', null),
		activeWindowSession: {
			position: { x: 1, y: 64, z: 1 },
			blockName: 'furnace'
		} as any,
		activeWindowSessionState: 'open',
		client
	})

	assert.equal(result.kind, 'failed')
	if (result.kind !== 'failed') {
		assert.fail('Expected failed result')
	}
	assert.match(
		result.reason,
		/open_window.*requires a window-compatible position grounded/i
	)
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
	assert.match(result.reason, /unsupported workstation for crafting tasks/i)
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

test('runAgentTurn accepts plain-text finish after a grounded world inspection in the same turn', async () => {
	const responses = [
		{
			id: 'resp_1',
			output: [
				{
					type: 'function_call',
					call_id: 'call_1',
					name: 'inspect_entities',
					arguments: JSON.stringify({
						max_distance: 32,
						max_results: 8
					})
				}
			]
		},
		{
			id: 'resp_2',
			output_text: 'Вижу Steve рядом со мной.',
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
		entities: {
			'1': {
				id: 1,
				username: 'Steve',
				name: 'player',
				type: 'player',
				position: createVec3(2, 64, 0),
				height: 1.8
			}
		},
		closeWindow: () => {}
	} as any

	const result = await runAgentTurn({
		bot,
		memory,
		currentGoal: 'Кто рядом?',
		subGoal: null,
		lastAction: null,
		lastResult: null,
		lastReason: null,
		errorHistory: [],
		taskContext: createTaskContext('Кто рядом?', null),
		client
	})

	assert.equal(result.kind, 'finish')
	if (result.kind !== 'finish') {
		assert.fail('Expected finish result')
	}
	assert.equal(result.message, 'Вижу Steve рядом со мной.')
	assert.match(result.transcript[0]!, /^round_0_ms:\d+$/)
	assert.equal(result.transcript[1]!, 'inspect_entities')
	assert.match(result.transcript[2]!, /^round_1_ms:\d+$/)
})

test('loop facade re-exports dedicated loop ownership modules', async () => {
	const [
		contracts,
		groundingModule,
		validationModule,
		policyModule,
		transcriptModule,
		runAgentTurnModule,
		facade
	] = await Promise.all([
		import('../../ai/contracts/agentTurn.js'),
		import('../../ai/loop/grounding.js'),
		import('../../ai/loop/validation.js'),
		import('../../ai/loop/policy.js'),
		import('../../ai/loop/transcript.js'),
		import('../../ai/loop/runAgentTurn.js'),
		import('../../ai/loop.js')
	])

	assert.equal('AgentTurnResult' in contracts, false)
	assert.equal(typeof groundingModule.collectGroundedFacts, 'function')
	assert.equal(typeof validationModule.validateExecutionTool, 'function')
	assert.equal(policyModule.MAX_INLINE_TOOL_ROUNDS, 4)
	assert.equal(
		transcriptModule.executionSignature('navigate_to', {
			position: { x: 1, y: 2, z: 3 }
		}),
		'navigate_to:{"position":{"x":1,"y":2,"z":3}}'
	)
	assert.equal(runAgentTurnModule.runAgentTurn, facade.runAgentTurn)
})
