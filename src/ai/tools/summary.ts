import type { PendingExecution } from '../contracts/execution.js'

export const summarizeExecution = (execution: PendingExecution): string => {
	switch (execution.toolName) {
		case 'navigate_to':
			return 'Move to target position'
		case 'break_block':
			return 'Break target block'
		case 'mine_resource':
			return `Mine ${String(execution.args.count ?? 1)} ${String(execution.args.block_name ?? 'blocks')}`
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
