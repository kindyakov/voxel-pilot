import assert from 'node:assert/strict'
import test from 'node:test'

import { OpenAIResponsesClient } from '../../ai/client.js'
import { runAgentTurn } from '../../ai/loop.js'

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
					name: 'call_navigate',
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
		client
	})

	assert.equal(result.kind, 'execute')
	if (result.kind !== 'execute') {
		assert.fail('Expected execution result')
	}
	assert.equal(result.execution.toolName, 'call_navigate')
	assert.deepEqual(result.execution.args, {
		position: { x: 12, y: 64, z: -4 },
		range: 2
	})
	assert.deepEqual(result.transcript, ['memory_read', 'call_navigate'])
})
