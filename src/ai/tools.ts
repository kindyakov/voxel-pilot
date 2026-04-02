import {
	closeWindowSessionSafely,
	describePlayerInventory,
	describeWindowSession,
	openWindowSession,
	type WindowSession
} from '@/ai/runtime/window.js'
import {
	inspectNearbyBlocks,
	inspectNearbyEntities,
	type InspectBlocksScope
} from '@/ai/runtime/inspect.js'
import type { Responses } from 'openai/resources/responses/responses'
import { Vec3 as Vec3Class } from 'vec3'

import type { Bot } from '@/types'

import type { MemoryEntryType, MemoryPosition } from '@/core/memory/types.js'

export type AgentToolName =
	| 'memory_save'
	| 'memory_read'
	| 'memory_update_data'
	| 'memory_delete'
	| 'inspect_inventory'
	| 'inspect_blocks'
	| 'inspect_entities'
	| 'inspect_window'
	| 'finish_goal'
	| 'navigate_to'
	| 'break_block'
	| 'place_block'
	| 'follow_entity'
	| 'open_window'
	| 'transfer_item'
	| 'close_window'

export type InlineToolName =
	| 'memory_save'
	| 'memory_read'
	| 'memory_update_data'
	| 'memory_delete'
	| 'inspect_inventory'
	| 'inspect_blocks'
	| 'inspect_entities'
	| 'inspect_window'

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
	activeWindowSession?: WindowSession | null
	activeWindowSessionState?: 'open' | 'close_failed' | null
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
	'Snapshot is runtime-only and does not include nearby world facts.',
	'Use inspect_blocks to find specific blocks by passing target_block_names, or use generic scope for world facts. Use inspect_entities for entities, inspect_inventory for player inventory, and inspect_window for container state.',
	'Before using navigate_to, break_block, place_block, follow_entity, or open_window, call memory_read or inspect tools in this turn to ground world facts.',
	'Never invent coordinates, blocks, entities, or containers that are not present in inspect/memory tool results.',
	'If the user asks you to come to them, follow them, or stay near them, prefer follow_entity with the matching nearby player name instead of navigate_to.',
	'Use open_window, transfer_item, and close_window for direct window interactions when the task requires moving items.',
	'When tasked with collecting or crafting a specific quantity of items, you MUST use inspect_inventory to verify if the required amount has been reached before deciding to continue or calling finish_goal.'
].join(' ')

const FUNCTION = 'function' as const

const executionToolNames = new Set<ExecutionToolName>([
	'navigate_to',
	'break_block',
	'place_block',
	'follow_entity',
	'open_window',
	'transfer_item',
	'close_window'
])

const inlineToolNames = new Set<InlineToolName>([
	'memory_save',
	'memory_read',
	'memory_update_data',
	'memory_delete',
	'inspect_inventory',
	'inspect_blocks',
	'inspect_entities',
	'inspect_window'
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

const getMemory = (bot: Bot) => bot.memory as any

const toPosition = (value: Record<string, unknown>): MemoryPosition => ({
	x: Number(value.x ?? 0),
	y: Number(value.y ?? 0),
	z: Number(value.z ?? 0)
})

const isRecord = (value: unknown): value is Record<string, unknown> =>
	Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const tryToPosition = (value: unknown): MemoryPosition | null => {
	if (!isRecord(value)) {
		return null
	}

	const x = Number(value.x)
	const y = Number(value.y)
	const z = Number(value.z)
	if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
		return null
	}

	return {
		x,
		y,
		z
	}
}

const toVec3 = (position: MemoryPosition) =>
	new Vec3Class(position.x, position.y, position.z)

const positionsEqual = (
	left: MemoryPosition | null | undefined,
	right: MemoryPosition | null | undefined
): boolean =>
	Boolean(
		left &&
			right &&
			left.x === right.x &&
			left.y === right.y &&
			left.z === right.z
	)

const toBlocksScope = (value: unknown): InspectBlocksScope => {
	if (value === 'interactables' || value === 'resources' || value === 'all') {
		return value
	}

	return 'all'
}

export const isExecutionToolName = (name: string): name is ExecutionToolName =>
	executionToolNames.has(name as ExecutionToolName)

export const isInlineToolName = (name: string): name is InlineToolName =>
	inlineToolNames.has(name as InlineToolName)

export const isControlToolName = (name: string): name is ControlToolName =>
	controlToolNames.has(name as ControlToolName)

export const summarizeExecution = (execution: PendingExecution): string => {
	switch (execution.toolName) {
		case 'navigate_to':
			return 'Move to target position'
		case 'break_block':
			return 'Break target block'
		case 'place_block':
			return `Place ${String(execution.args.block_name ?? 'block')}`
		case 'follow_entity':
			return 'Follow target entity'
		case 'open_window':
			return 'Open window'
		case 'transfer_item':
			return `Transfer ${String(execution.args.item_name ?? 'item')}`
		case 'close_window':
			return 'Close window'
	}

	return execution.toolName
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
		case 'inspect_inventory': {
			const inventory = describePlayerInventory(context.bot)
			return { ok: true, output: { inventory } }
		}
		case 'inspect_blocks': {
			const scope = toBlocksScope(args.scope)
			const maxDistance =
				typeof args.max_distance === 'number' ? args.max_distance : undefined
			const targetBlockNames = Array.isArray(args.target_block_names)
				? args.target_block_names.map(String)
				: undefined
			const blocks = inspectNearbyBlocks(context.bot, {
				scope,
				targetBlockNames,
				maxDistance
			})

			return {
				ok: true,
				output: {
					scope,
					targetBlockNames: targetBlockNames ?? null,
					maxDistance: maxDistance ?? null,
					blocks
				}
			}
		}
		case 'inspect_entities': {
			const maxDistance =
				typeof args.max_distance === 'number' ? args.max_distance : undefined
			const entities = inspectNearbyEntities(context.bot, {
				maxDistance
			})

			return {
				ok: true,
				output: {
					maxDistance: maxDistance ?? null,
					entities
				}
			}
		}
		case 'inspect_window': {
			const requestedPosition = tryToPosition(args.position)
			const activeSession = context.activeWindowSession ?? null
			const activeSessionState = context.activeWindowSessionState ?? null
			const isStaleActiveSession = activeSessionState === 'close_failed'
			const canReuseActiveSession =
				Boolean(activeSession) &&
				(!requestedPosition ||
					positionsEqual(activeSession?.position, requestedPosition))

			if (isStaleActiveSession) {
				return {
					ok: false,
					output: {
						reason:
							'Active window session is stale (previous close failed). Resolve with close_window before inspect_window.'
					}
				}
			}

			if (
				activeSession &&
				requestedPosition &&
				!positionsEqual(activeSession.position, requestedPosition)
			) {
				return {
					ok: false,
					output: {
						reason:
							'Active window session is already open at a different position. Close it with close_window before inspect_window at another location.'
					}
				}
			}

			if (activeSession && canReuseActiveSession) {
				return {
					ok: true,
					output: {
						reusedActiveSession: true,
						kind: activeSession.kind,
						blockName: activeSession.blockName,
						window: describeWindowSession(activeSession),
						closeFailed: false
					}
				}
			}

			if (!requestedPosition) {
				return {
					ok: false,
					output: {
						reason:
							'No active window session. Provide position to inspect nearby window block.'
					}
				}
			}

			const block = context.bot.blockAt(toVec3(requestedPosition))
			if (!block) {
				return { ok: false, output: { reason: 'Window block not found' } }
			}

			const distance = context.bot.entity.position.distanceTo(block.position)
			if (distance > 4) {
				return {
					ok: false,
					output: {
						reason: `Window is too far away (${distance.toFixed(1)}m)`
					}
				}
			}

			let session: Awaited<ReturnType<typeof openWindowSession>> | null = null

			try {
				session = await openWindowSession(context.bot, block, requestedPosition)

				const window = describeWindowSession(session)
				const closeResult = closeWindowSessionSafely(context.bot, session)
				if (!closeResult.ok) {
					return {
						ok: false,
						output: {
							reason:
								'Failed to close temporary window session after inspect_window; runtime window state is untrusted.',
							close: closeResult
						}
					}
				}

				return {
					ok: true,
					output: {
						reusedActiveSession: false,
						blockName: block.name,
						kind: session.kind,
						window,
						close: closeResult
					}
				}
			} catch (error) {
				if (session) {
					closeWindowSessionSafely(context.bot, session)
				}

				return {
					ok: false,
					output: {
						reason:
							error instanceof Error
								? error.message
								: 'Unsupported window block'
					}
				}
			}
		}
	}
}
