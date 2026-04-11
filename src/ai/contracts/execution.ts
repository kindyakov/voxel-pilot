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
	| 'mine_resource'
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
