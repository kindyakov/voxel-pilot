import assert from 'node:assert/strict'
import test from 'node:test'

import { AGENT_TOOLS } from '../../ai/tools/catalog.js'
import { parseExecution } from '../../ai/tools/executionDefinitions.js'

test('an action rejects malformed optional arguments instead of silently defaulting them', () => {
	const result = parseExecution('navigate_to', {
		position: { x: 1, y: 64, z: 2 },
		range: 'near'
	})
	assert.equal(result.ok, false)
	if (!result.ok) assert.match(result.reason, /range/)
})

test('action parsing covers every execution category and preserves valid arguments', () => {
	const position = { x: 1, y: 64, z: 2 }
	const actions = [
		['navigate_to', { position }],
		['break_block', { position }],
		['mine_resource', { block_name: 'stone', count: 2 }],
		[
			'mine_resource',
			{ block_name: 'coal_ore', resource_name: 'coal', count: 10 }
		],
		[
			'tasks_create',
			{ block_name: 'coal_ore', resource_name: 'coal_ore', count: 10 }
		],
		['place_block', { block_name: 'stone', position }],
		['follow_entity', { entity_name: 'Steve' }],
		['open_window', { position }],
		[
			'transfer_item',
			{
				source_zone: 'container',
				dest_zone: 'hotbar',
				item_name: 'stone',
				count: 1
			}
		],
		['close_window', {}],
		['tasks_create', { block_name: 'iron_ore', count: 2 }],
		['tasks_start', { task_id: 'task-1' }],
		['tasks_cancel', { task_id: 'task-1' }]
	] as const
	for (const [name, args] of actions) {
		const result = parseExecution(name, args)
		assert.equal(result.ok, true, name)
		if (result.ok) assert.deepEqual(result.execution, { toolName: name, args })
	}
})

test('invalid action values and unknown fields cannot reach execution', () => {
	const position = { x: 1, y: 64, z: 2 }
	for (const [name, args] of [
		['navigate_to', { position, range: -1 }],
		['navigate_to', { position: { ...position, x: Infinity } }],
		['navigate_to', { position, typo: 2 }],
		['mine_resource', { block_name: 'stone', count: 1.5 }],
		['mine_resource', { block_name: 'stone', count: 65 }],
		['mine_resource', { block_name: 'coal_ore', resource_name: '', count: 10 }],
		[
			'mine_resource',
			{ block_name: 'coal_ore', resource_name: null, count: 10 }
		],
		['tasks_create', { block_name: '', count: 2 }],
		['tasks_create', { block_name: 'stone', count: 0 }],
		['tasks_start', {}],
		['tasks_start', { task_id: '' }],
		['tasks_cancel', { task_id: 7 }],
		['place_block', { position, block_name: '' }],
		[
			'place_block',
			{ position, block_name: 'stone', face_vector: { x: 1, y: 1, z: 0 } }
		],
		['follow_entity', {}],
		['follow_entity', { entity_name: 'Steve', distance: null }],
		[
			'transfer_item',
			{
				source_zone: 'container',
				dest_zone: 'container',
				item_name: 'stone',
				count: 1
			}
		]
	] as const)
		assert.equal(
			parseExecution(name, args).ok,
			false,
			`${name}: ${JSON.stringify(args)}`
		)
})

test('provider tools preserve omitted optional fields instead of requiring nullable placeholders', () => {
	for (const tool of AGENT_TOOLS) assert.equal(tool.strict, false, tool.name)
})
