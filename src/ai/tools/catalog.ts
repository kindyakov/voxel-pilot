import type { AgentToolDefinition } from '../contracts/agentClient.js'
import type { AgentToolName } from '../contracts/execution.js'
import { positionSchema, vectorSchema } from './shared.js'

const FUNCTION = 'function' as const

const tool = (
	name: AgentToolName,
	description: string,
	parameters: Record<string, unknown>
): AgentToolDefinition => ({
	type: FUNCTION,
	name,
	description,
	strict: true,
	parameters
})

export const AGENT_TOOLS: AgentToolDefinition[] = [
	tool('memory_save', 'Save or update long-term memory.', {
		type: 'object',
		additionalProperties: false,
		properties: {
			type: {
				type: 'string',
				enum: ['container', 'location', 'resource', 'danger']
			},
			position: positionSchema,
			tags: {
				type: 'array',
				items: { type: 'string' }
			},
			description: { type: 'string' },
			data: {
				type: 'object',
				additionalProperties: true
			}
		},
		required: ['type', 'position', 'tags', 'description', 'data']
	}),
	tool('memory_read', 'Read memory entries by tags and distance.', {
		type: 'object',
		additionalProperties: false,
		properties: {
			query_tags: {
				type: 'array',
				items: { type: 'string' }
			},
			max_distance: { type: 'number' }
		},
		required: ['query_tags', 'max_distance']
	}),
	tool('memory_update_data', 'Update memory entry JSON data by id.', {
		type: 'object',
		additionalProperties: false,
		properties: {
			id: { type: 'string' },
			data: {
				type: 'object',
				additionalProperties: true
			}
		},
		required: ['id', 'data']
	}),
	tool('memory_delete', 'Delete memory entry by id or position.', {
		type: 'object',
		additionalProperties: false,
		properties: {
			id: { type: 'string' },
			position: positionSchema,
			type: {
				type: 'string',
				enum: ['container', 'location', 'resource', 'danger']
			}
		},
		required: []
	}),
	tool('inspect_inventory', 'Inspect the player inventory.', {
		type: 'object',
		additionalProperties: false,
		properties: {},
		required: []
	}),
	tool(
		'inspect_blocks',
		'Inspect nearby interactable/resource blocks from live world state.',
		{
			type: 'object',
			additionalProperties: false,
			properties: {
				scope: {
					type: 'string',
					enum: ['interactables', 'resources', 'all']
				},
				target_block_names: {
					type: 'array',
					items: { type: 'string' }
				},
				max_distance: { type: 'number' }
			},
			required: []
		}
	),
	tool('inspect_entities', 'Inspect nearby entities from live world state.', {
		type: 'object',
		additionalProperties: false,
		properties: {
			max_distance: { type: 'number' }
		},
		required: []
	}),
	tool(
		'inspect_window',
		'Inspect an active window session or a nearby window-bearing block.',
		{
			type: 'object',
			additionalProperties: false,
			properties: {
				position: positionSchema
			},
			required: []
		}
	),
	tool('finish_goal', 'Finish the current goal.', {
		type: 'object',
		additionalProperties: false,
		properties: {
			message: { type: 'string' },
			summary: { type: 'string' }
		},
		required: []
	}),
	tool('navigate_to', 'Navigate to a target position.', {
		type: 'object',
		additionalProperties: false,
		properties: {
			position: positionSchema,
			range: { type: 'number' }
		},
		required: ['position']
	}),
	tool('break_block', 'Break a block at a target position.', {
		type: 'object',
		additionalProperties: false,
		properties: {
			position: positionSchema
		},
		required: ['position']
	}),
	tool(
		'mine_resource',
		'Mine a specific quantity of a block type efficiently. Use for resource gathering tasks like mining ore, wood, or other materials. Executes batch search and cyclic mining without repeated LLM calls.',
		{
			type: 'object',
			additionalProperties: false,
			properties: {
				block_name: {
					type: 'string',
					description:
						'Block type to mine (e.g., iron_ore, coal_ore, diamond_ore, oak_log)'
				},
				count: {
					type: 'number',
					description: 'Number of blocks to mine',
					minimum: 1,
					maximum: 64
				}
			},
			required: ['block_name', 'count']
		}
	),
	tool('place_block', 'Place a block from inventory.', {
		type: 'object',
		additionalProperties: false,
		properties: {
			block_name: { type: 'string' },
			position: positionSchema,
			face_vector: vectorSchema
		},
		required: ['block_name', 'position']
	}),
	tool('follow_entity', 'Follow the nearest matching entity.', {
		type: 'object',
		additionalProperties: false,
		properties: {
			entity_name: { type: 'string' },
			entity_type: { type: 'string' },
			max_distance: { type: 'number' },
			distance: { type: 'number' }
		},
		required: []
	}),
	tool('open_window', 'Open a nearby window-bearing block.', {
		type: 'object',
		additionalProperties: false,
		properties: {
			position: positionSchema
		},
		required: ['position']
	}),
	tool('transfer_item', 'Transfer an item between semantic window zones.', {
		type: 'object',
		additionalProperties: false,
		properties: {
			source_zone: {
				type: 'string',
				enum: [
					'player_inventory',
					'hotbar',
					'container',
					'input',
					'fuel',
					'output'
				]
			},
			dest_zone: {
				type: 'string',
				enum: [
					'player_inventory',
					'hotbar',
					'container',
					'input',
					'fuel',
					'output'
				]
			},
			item_name: { type: 'string' },
			count: { type: 'number' }
		},
		required: ['source_zone', 'dest_zone', 'item_name', 'count']
	}),
	tool('close_window', 'Close the currently open window.', {
		type: 'object',
		additionalProperties: false,
		properties: {},
		required: []
	})
]
