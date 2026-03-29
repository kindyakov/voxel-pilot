import type { Responses } from 'openai/resources/responses/responses'
import { Vec3 as Vec3Class } from 'vec3'

import type { Bot } from '@/types'

import type { MemoryEntryType, MemoryPosition } from '@/core/memory/types.js'

export type AgentToolName =
	| 'memory_save'
	| 'memory_read'
	| 'memory_update_data'
	| 'memory_delete'
	| 'inspect_container'
	| 'finish_goal'
	| 'call_navigate'
	| 'call_break_block'
	| 'call_craft'
	| 'call_craft_workbench'
	| 'call_smelt'
	| 'call_place_block'
	| 'call_follow_entity'

export type InlineToolName =
	| 'memory_save'
	| 'memory_read'
	| 'memory_update_data'
	| 'memory_delete'
	| 'inspect_container'

export type ControlToolName = 'finish_goal'

export type ExecutionToolName = Exclude<
	AgentToolName,
	InlineToolName | ControlToolName
>

export interface PendingExecution {
	toolName: ExecutionToolName
	args: Record<string, unknown>
}

interface InlineToolExecutionContext {
	bot: Bot
}

interface InlineToolExecutionResult {
	ok: boolean
	output: Record<string, unknown>
}

export type AgentToolDefinition = Responses.FunctionTool

export const AGENT_SYSTEM_PROMPT = [
	'You are the Minecraft AGENT_LOOP controller.',
	'Use only tools. Do not answer with plain text.',
	'Use memory tools for retrieval and updates, execution tools for one concrete action, and finish_goal when the goal is complete.',
	'Return exactly one execution decision after enough information is gathered.',
	'Keep arguments concrete and minimal.',
	'Never invent coordinates, blocks, entities, or containers that are not present in the snapshot or tool results.',
	'If the user asks you to come to them, follow them, or stay near them, prefer call_follow_entity with the matching nearby player name instead of call_navigate.',
	'SPEED IS CRITICAL: If the goal is simple movement (follow player, go to coordinates), return an execution tool IMMEDIATELY in the first round without calling informational tools.'
].join(' ')

const FUNCTION = 'function' as const
const CONTAINER_NAMES = [
	'chest',
	'trapped_chest',
	'ender_chest',
	'furnace',
	'blast_furnace',
	'smoker',
	'dispenser',
	'dropper',
	'hopper',
	'barrel',
	'shulker_box'
]

const WORKBENCH_NAMES = [
	'crafting_table',
	'cartography_table',
	'smithing_table',
	'grindstone',
	'loom',
	'stonecutter',
	'enchanting_table',
	'anvil'
]

const executionToolNames = new Set<ExecutionToolName>([
	'call_navigate',
	'call_break_block',
	'call_craft',
	'call_craft_workbench',
	'call_smelt',
	'call_place_block',
	'call_follow_entity'
])

const inlineToolNames = new Set<InlineToolName>([
	'memory_save',
	'memory_read',
	'memory_update_data',
	'memory_delete',
	'inspect_container'
])

const controlToolNames = new Set<ControlToolName>(['finish_goal'])

const positionSchema = {
	type: 'object',
	additionalProperties: false,
	properties: {
		x: { type: 'number' },
		y: { type: 'number' },
		z: { type: 'number' }
	},
	required: ['x', 'y', 'z']
} satisfies Record<string, unknown>

const vectorSchema = {
	type: 'object',
	additionalProperties: false,
	properties: {
		x: { type: 'number' },
		y: { type: 'number' },
		z: { type: 'number' }
	},
	required: ['x', 'y', 'z']
} satisfies Record<string, unknown>

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
	tool(
		'inspect_container',
		'Inspect nearby container/workstation and persist contents.',
		{
			type: 'object',
			additionalProperties: false,
			properties: {
				position: positionSchema
			},
			required: ['position']
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
	tool('call_navigate', 'Navigate to a target position.', {
		type: 'object',
		additionalProperties: false,
		properties: {
			position: positionSchema,
			range: { type: 'number' }
		},
		required: ['position']
	}),
	tool('call_break_block', 'Break a block at a target position.', {
		type: 'object',
		additionalProperties: false,
		properties: {
			position: positionSchema
		},
		required: ['position']
	}),
	tool('call_craft', 'Craft an inventory-only recipe.', {
		type: 'object',
		additionalProperties: false,
		properties: {
			item_name: { type: 'string' },
			count: { type: 'number' }
		},
		required: ['item_name']
	}),
	tool('call_craft_workbench', 'Craft an item at a workbench.', {
		type: 'object',
		additionalProperties: false,
		properties: {
			item_name: { type: 'string' },
			workbench_position: positionSchema,
			count: { type: 'number' }
		},
		required: ['item_name', 'workbench_position']
	}),
	tool('call_smelt', 'Smelt an item at a furnace.', {
		type: 'object',
		additionalProperties: false,
		properties: {
			input_item_name: { type: 'string' },
			fuel_item_name: { type: 'string' },
			furnace_position: positionSchema,
			count: { type: 'number' }
		},
		required: ['input_item_name', 'furnace_position']
	}),
	tool('call_place_block', 'Place a block from inventory.', {
		type: 'object',
		additionalProperties: false,
		properties: {
			block_name: { type: 'string' },
			position: positionSchema,
			face_vector: vectorSchema
		},
		required: ['block_name', 'position']
	}),
	tool('call_follow_entity', 'Follow the nearest matching entity.', {
		type: 'object',
		additionalProperties: false,
		properties: {
			entity_name: { type: 'string' },
			entity_type: { type: 'string' },
			max_distance: { type: 'number' },
			distance: { type: 'number' }
		},
		required: []
	})
]

const getMemory = (bot: Bot) => bot.memory as any

const toPosition = (value: Record<string, unknown>): MemoryPosition => ({
	x: Number(value.x ?? 0),
	y: Number(value.y ?? 0),
	z: Number(value.z ?? 0)
})

const toVec3 = (position: MemoryPosition) =>
	new Vec3Class(position.x, position.y, position.z)

const serializeContainerItems = (
	items: any[]
): Array<Record<string, unknown>> =>
	items.filter(Boolean).map(item => ({
		name: item.name,
		count: item.count,
		slot: item.slot,
		maxDurability: item.maxDurability,
		durabilityUsed: item.durabilityUsed
	}))

const openContainerWindow = async (bot: Bot, block: any): Promise<any> => {
	if (CONTAINER_NAMES.some(name => block.name.includes(name))) {
		if (block.name.includes('chest')) {
			return bot.openChest(block)
		}

		if (
			block.name.includes('furnace') ||
			block.name.includes('blast_furnace') ||
			block.name.includes('smoker')
		) {
			return bot.openFurnace(block)
		}

		return bot.openContainer(block)
	}

	if (WORKBENCH_NAMES.some(name => block.name.includes(name))) {
		return bot.openBlock(block)
	}

	return bot.openContainer(block)
}

const closeWindow = (bot: Bot, window: any): void => {
	if (!window) {
		return
	}

	if (typeof window.close === 'function') {
		window.close()
		return
	}

	bot.closeWindow(window)
}

export const isExecutionToolName = (name: string): name is ExecutionToolName =>
	executionToolNames.has(name as ExecutionToolName)

export const isInlineToolName = (name: string): name is InlineToolName =>
	inlineToolNames.has(name as InlineToolName)

export const isControlToolName = (name: string): name is ControlToolName =>
	controlToolNames.has(name as ControlToolName)

export const summarizeExecution = (execution: PendingExecution): string => {
	switch (execution.toolName) {
		case 'call_navigate':
			return 'Move to target position'
		case 'call_break_block':
			return 'Break target block'
		case 'call_craft':
			return `Craft ${String(execution.args.item_name ?? 'item')}`
		case 'call_craft_workbench':
			return `Craft ${String(execution.args.item_name ?? 'item')} at workbench`
		case 'call_smelt':
			return `Smelt ${String(execution.args.input_item_name ?? 'item')}`
		case 'call_place_block':
			return `Place ${String(execution.args.block_name ?? 'block')}`
		case 'call_follow_entity':
			return 'Follow target entity'
	}
}

export const executeInlineToolCall = async (
	name: InlineToolName,
	args: Record<string, unknown>,
	context: InlineToolExecutionContext
): Promise<InlineToolExecutionResult> => {
	const memory = getMemory(context.bot)

	switch (name) {
		case 'memory_save': {
			const entry = memory.saveEntry({
				type: String(args.type) as MemoryEntryType,
				position: toPosition(args.position as Record<string, unknown>),
				tags: Array.isArray(args.tags) ? args.tags.map(String) : [],
				description: String(args.description ?? ''),
				data:
					args.data &&
					typeof args.data === 'object' &&
					!Array.isArray(args.data)
						? (args.data as Record<string, unknown>)
						: {}
			})

			return { ok: true, output: { entry } }
		}
		case 'memory_read': {
			const entries = memory.readEntries({
				queryTags: Array.isArray(args.query_tags)
					? args.query_tags.map(String)
					: [],
				origin: context.bot.entity?.position
					? {
							x: context.bot.entity.position.x,
							y: context.bot.entity.position.y,
							z: context.bot.entity.position.z
						}
					: undefined,
				maxDistance: Number(args.max_distance ?? 0)
			})
			return { ok: true, output: { entries } }
		}
		case 'memory_update_data': {
			const entry = memory.updateEntryData(
				String(args.id ?? ''),
				args.data && typeof args.data === 'object' && !Array.isArray(args.data)
					? (args.data as Record<string, unknown>)
					: {}
			)
			return { ok: Boolean(entry), output: { updated: Boolean(entry), entry } }
		}
		case 'memory_delete': {
			const deleted = memory.deleteEntry({
				id: typeof args.id === 'string' ? args.id : undefined,
				position:
					args.position && typeof args.position === 'object'
						? toPosition(args.position as Record<string, unknown>)
						: undefined,
				type:
					typeof args.type === 'string'
						? (args.type as MemoryEntryType)
						: undefined
			})
			return { ok: deleted, output: { deleted } }
		}
		case 'inspect_container': {
			const position = toPosition(args.position as Record<string, unknown>)
			const block = context.bot.blockAt(toVec3(position))
			if (!block) {
				return { ok: false, output: { reason: 'Container block not found' } }
			}

			const distance = context.bot.entity.position.distanceTo(block.position)
			if (distance > 4) {
				return {
					ok: false,
					output: {
						reason: `Container is too far away (${distance.toFixed(1)}m)`
					}
				}
			}

			const windowRef = await openContainerWindow(context.bot, block)
			try {
				const items = serializeContainerItems(
					typeof windowRef.containerItems === 'function'
						? windowRef.containerItems()
						: typeof windowRef.items === 'function'
							? windowRef.items()
							: []
				)

				const entry = memory.saveEntry({
					type: 'container',
					position,
					tags: [block.name],
					description: `Inspected ${block.name}`,
					data: {
						blockName: block.name,
						items,
						inspectedAt: new Date().toISOString()
					}
				})

				return { ok: true, output: { blockName: block.name, items, entry } }
			} finally {
				closeWindow(context.bot, windowRef)
			}
		}
	}
}
