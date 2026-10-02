import { TASK_STATUSES } from '@/core/memory/types.js'

import type { AgentToolDefinition } from '../contracts/agentClient.js'
import type { AgentToolName } from '../contracts/execution.js'
import { executionDefinitions } from './executionDefinitions.js'
import { positionSchema } from './shared.js'

const FUNCTION = 'function' as const

const tool = (
	name: AgentToolName,
	description: string,
	parameters: Record<string, unknown>
): AgentToolDefinition => ({
	type: FUNCTION,
	name,
	description,
	strict: false,
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
	tool('tasks_list', 'List persistent tasks (survive restarts as suspended).', {
		type: 'object',
		additionalProperties: false,
		properties: {
			status: {
				type: 'string',
				enum: [...TASK_STATUSES]
			}
		},
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
	...Object.values(executionDefinitions).map(definition => definition.tool)
]
