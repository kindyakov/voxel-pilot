import { TASK_STATUSES } from '@/core/memory/types.js'

import type {
	InlineToolExecutionContext,
	InlineToolExecutionResult
} from '../inlineExecutor.js'
import { getMemory } from '../shared.js'

export const executeTasksListTool = async (
	args: Record<string, unknown>,
	context: InlineToolExecutionContext
): Promise<InlineToolExecutionResult> => {
	// No degraded mode: the contract is Bot.memory: MemoryManager. A broken
	// wiring surfaces as an explicit inline failure, never silent behavior.
	const memory = getMemory(context.bot)

	const status =
		typeof args.status === 'string' &&
		(TASK_STATUSES as readonly string[]).includes(args.status)
			? (args.status as (typeof TASK_STATUSES)[number])
			: undefined
	if (args.status !== undefined && status === undefined) {
		return {
			ok: false,
			output: {
				reason: `tasks_list status must be one of: ${TASK_STATUSES.join(', ')}`
			}
		}
	}

	const tasks = memory.listTasks(status ? { status } : {}).map(record => ({
		id: record.id,
		kind: record.kind,
		block_name: record.blockName,
		resource_name: record.resourceName ?? null,
		total: record.total,
		done: record.done,
		status: record.status,
		updated_at: record.updatedAt
	}))

	return { ok: true, output: { tasks } }
}
