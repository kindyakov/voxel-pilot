import type { WindowSession } from '@/ai/runtime/window.js'

import type { Bot } from '@/types'

import type { InlineToolName } from '../contracts/execution.js'
import { executeInspectTool } from './executors/inspect.js'
import { executeMemoryTool } from './executors/memory.js'
import { executeWindowTool } from './executors/window.js'

export interface InlineToolExecutionContext {
	bot: Bot
	activeWindowSession?: WindowSession | null
	activeWindowSessionState?: 'open' | 'close_failed' | null
}

export interface InlineToolExecutionResult {
	ok: boolean
	output: Record<string, unknown>
}

export const executeInlineToolCall = async (
	name: InlineToolName,
	args: Record<string, unknown>,
	context: InlineToolExecutionContext
): Promise<InlineToolExecutionResult> => {
	switch (name) {
		case 'memory_save':
		case 'memory_read':
		case 'memory_update_data':
		case 'memory_delete':
			return executeMemoryTool(name, args, context)
		case 'inspect_inventory':
		case 'inspect_blocks':
		case 'inspect_entities':
			return executeInspectTool(name, args, context)
		case 'inspect_window':
			return executeWindowTool(args, context)
	}
}
