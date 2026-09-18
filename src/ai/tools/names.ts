import type { ControlToolName, InlineToolName } from '../contracts/execution.js'

export type {
	AgentToolName,
	ControlToolName,
	ExecutionToolName,
	InlineToolName
} from '../contracts/execution.js'

const inlineToolNames = new Set<InlineToolName>([
	'memory_save',
	'memory_read',
	'memory_update_data',
	'memory_delete',
	'inspect_inventory',
	'inspect_blocks',
	'inspect_entities',
	'inspect_window',
	'tasks_list'
])

const controlToolNames = new Set<ControlToolName>(['finish_goal'])

export { isExecutionName as isExecutionToolName } from './executionDefinitions.js'

export const isInlineToolName = (name: string): name is InlineToolName =>
	inlineToolNames.has(name as InlineToolName)

export const isControlToolName = (name: string): name is ControlToolName =>
	controlToolNames.has(name as ControlToolName)
