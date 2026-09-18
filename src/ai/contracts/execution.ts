import type { ExecutionToolName } from '../tools/executionDefinitions.js'

export type {
	ExecutionToolName,
	PendingExecution
} from '../tools/executionDefinitions.js'

export type AgentToolName = InlineToolName | ControlToolName | ExecutionToolName

export type InlineToolName =
	| 'memory_save'
	| 'memory_read'
	| 'memory_update_data'
	| 'memory_delete'
	| 'inspect_inventory'
	| 'inspect_blocks'
	| 'inspect_entities'
	| 'inspect_window'
	| 'tasks_list'

export type ControlToolName = 'finish_goal'
