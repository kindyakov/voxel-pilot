import type {
	ControlToolName,
	ExecutionToolName,
	InlineToolName
} from '../contracts/execution.js'

export type {
	AgentToolName,
	ControlToolName,
	ExecutionToolName,
	InlineToolName
} from '../contracts/execution.js'

const executionToolNames = new Set<ExecutionToolName>([
	'navigate_to',
	'break_block',
	'mine_resource',
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

export const isExecutionToolName = (name: string): name is ExecutionToolName =>
	executionToolNames.has(name as ExecutionToolName)

export const isInlineToolName = (name: string): name is InlineToolName =>
	inlineToolNames.has(name as InlineToolName)

export const isControlToolName = (name: string): name is ControlToolName =>
	controlToolNames.has(name as ControlToolName)
