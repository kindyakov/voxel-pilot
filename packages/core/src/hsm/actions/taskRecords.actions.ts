import { assign } from 'xstate'

import Logger from '@/config/logger.js'

import type { MemoryManager } from '@/core/memory/index.js'
import {
	type PersistentTaskRecord,
	type PersistentTaskStatus,
	normalizeTaskDone
} from '@/core/memory/types.js'

import type { MachineContext } from '@/hsm/context.js'
import { resolveMiningResource } from '@/hsm/tasks/miningResource.js'
import {
	type MiningTask,
	getMiningTask,
	miningTaskFromRecord
} from '@/hsm/tasks/task.js'
import type { MachineEvent } from '@/hsm/types.js'

import {
	type GoalExecutionState,
	advanceGoalExecution
} from '@/ai/goalExecution.js'

/**
 * The declared contract is `Bot.memory: MemoryManager`. There is no degraded
 * mode: a missing store is an explicit failure (compute ops) or an explicit
 * error log (fire-and-forget sync), never a silent skip.
 */
const taskMemoryOf = (context: MachineContext): MemoryManager | null =>
	context.bot?.memory ?? null

const taskIdOf = (context: MachineContext): string | null =>
	getMiningTask(context.taskData)?.taskId ?? null

const matchesTaskDefinition = (
	record: PersistentTaskRecord,
	task: MiningTask
): boolean =>
	record.kind === task.kind &&
	record.blockName === task.blockName &&
	record.resourceName === task.resourceName &&
	record.total === task.count

const hasValidTaskProgress = (
	record: Pick<PersistentTaskRecord, 'done' | 'total'>
): boolean =>
	Number.isInteger(record.done) &&
	record.done >= 0 &&
	record.done <= record.total

type ExpectedRow = Pick<
	PersistentTaskRecord,
	'id' | 'status' | 'kind' | 'blockName' | 'resourceName' | 'total' | 'done'
>

/**
 * Unified echo-validator for every store mutation (ADR §6, ARCHITECTURE
 * explicit-contracts rule): id and status always, immutable payload and
 * done wherever the caller knows them. A store that answers null — or the
 * wrong row — fails the operation instead of running on a lie.
 */
const matchRow = (
	written: PersistentTaskRecord | null | undefined,
	expected: ExpectedRow
): written is PersistentTaskRecord => {
	return (
		written?.id === expected.id &&
		written.status === expected.status &&
		written.kind === expected.kind &&
		written.blockName === expected.blockName &&
		written.resourceName === expected.resourceName &&
		written.total === expected.total &&
		written.done === expected.done
	)
}

const TERMINAL_TASK_STATUSES: ReadonlySet<PersistentTaskStatus> = new Set([
	'completed',
	'failed',
	'cancelled'
])

const isTerminalTaskStatus = (status: PersistentTaskStatus): boolean =>
	TERMINAL_TASK_STATUSES.has(status)

const syncRecord = (
	context: MachineContext,
	done: number,
	status: PersistentTaskStatus | undefined,
	onlyFrom?: PersistentTaskStatus
): void => {
	const task = getMiningTask(context.taskData)
	const memory = taskMemoryOf(context)
	if (!task?.taskId || !memory) {
		Logger.error('[TASKS] record sync prerequisites unavailable', {
			taskId: task?.taskId ?? null,
			hasMemory: Boolean(memory),
			status: status ?? null,
			onlyFrom: onlyFrom ?? null,
			done
		})
		return
	}
	const taskId = task.taskId

	try {
		// One pre-read classifies the row and validates it against the runtime
		// task. An omitted target status keeps the current status atomically.
		const pre = memory.getTask(taskId)
		if (!pre || pre.id !== taskId) {
			Logger.error('[TASKS] sync pre-read: row is gone or foreign', {
				taskId,
				returnedId: pre?.id ?? null,
				status: pre?.status ?? null
			})
			return
		}
		if (!matchesTaskDefinition(pre, task) || !hasValidTaskProgress(pre)) {
			Logger.error('[TASKS] sync pre-read: task payload mismatch', {
				taskId,
				expected: {
					kind: task.kind,
					blockName: task.blockName,
					resourceName: task.resourceName,
					total: task.count
				},
				returned: pre
			})
			return
		}
		if (onlyFrom && pre.status !== onlyFrom) {
			// Debug only for the expected race: somebody else already
			// moved the row terminal. Anything else is integrity noise.
			if (isTerminalTaskStatus(pre.status)) {
				Logger.debug('[TASKS] record sync skipped, status already moved on', {
					taskId,
					status: pre.status
				})
			} else {
				Logger.error('[TASKS] sync pre-read: unexpected nonterminal status', {
					taskId,
					status: pre.status,
					expected: onlyFrom
				})
			}
			return
		}
		const target = status ?? pre.status
		const written = memory.updateTaskProgress(taskId, done, {
			status,
			onlyFrom
		})
		if (!written && onlyFrom) {
			const moved = memory.getTask(taskId)
			if (
				moved?.id === taskId &&
				matchesTaskDefinition(moved, task) &&
				hasValidTaskProgress(moved) &&
				isTerminalTaskStatus(moved.status)
			) {
				Logger.debug('[TASKS] record sync skipped, status already moved on', {
					taskId,
					status: moved.status
				})
				return
			}
			Logger.error(
				'[TASKS] sync retry read: row is gone, foreign, or corrupt',
				{
					taskId,
					returned: moved
				}
			)
			return
		}
		const expectedDone = normalizeTaskDone(done, pre.total)
		if (
			!matchRow(written, {
				id: taskId,
				status: target,
				kind: task.kind,
				blockName: task.blockName,
				resourceName: task.resourceName,
				total: task.count,
				done: expectedDone
			})
		) {
			Logger.error('[TASKS] record sync mismatch', {
				taskId,
				status: target,
				done: expectedDone,
				written
			})
		}
	} catch (error) {
		Logger.error('[TASKS] record sync failed', { error: String(error) })
	}
}

export interface TaskOpOutcome {
	lastAction: string
	lastActionArgs: Record<string, unknown>
	lastResult: 'SUCCESS' | 'FAILED'
	lastReason: string | null
	pendingExecution: MachineContext['pendingExecution']
	errorHistory: string[]
	lastToolTranscript: string[]
	goalExecution: GoalExecutionState
	taskData: MachineContext['taskData']
}

const successOutcome = (
	context: MachineContext,
	toolName: string,
	args: Record<string, unknown>,
	extra: Partial<TaskOpOutcome> = {}
): TaskOpOutcome => ({
	lastAction: toolName,
	lastActionArgs: args,
	lastResult: 'SUCCESS',
	lastReason: null,
	pendingExecution: context.pendingExecution,
	errorHistory: context.errorHistory,
	lastToolTranscript: [toolName],
	goalExecution: advanceGoalExecution(context.goalExecution, {
		type: 'succeeded'
	}),
	taskData: context.taskData,
	...extra
})

const failureOutcome = (
	context: MachineContext,
	toolName: string,
	args: Record<string, unknown>,
	reason: string
): TaskOpOutcome => ({
	lastAction: toolName,
	lastActionArgs: args,
	lastResult: 'FAILED',
	lastReason: reason,
	pendingExecution: null,
	errorHistory: [...context.errorHistory, reason].slice(-3),
	lastToolTranscript: [toolName],
	goalExecution: advanceGoalExecution(context.goalExecution, {
		type: 'failed',
		reason
	}),
	taskData: context.taskData
})

const pendingArgs = (
	context: MachineContext,
	toolName: string
): Record<string, unknown> => {
	const pending = context.pendingExecution
	return (pending?.toolName === toolName ? pending.args : {}) as Record<
		string,
		unknown
	>
}

const normalizeBlockName = (value: unknown): string =>
	typeof value === 'string' ? value.trim().toLowerCase() : ''

/**
 * MINING entry hook. Links the running task to its persistent row, or
 * reactivates a suspended row on resume (suspended → active) so the record
 * is truthful while the task runs, crash recovery sees it, and the next
 * preemption syncs `done`.
 *
 * A link failure never runs unlinked: the task is returned failure-marked
 * (no `taskId`, reason in `lastFailure`) and the machine routes it to
 * TASK_FAILED before any digging starts.
 */
export const enterTaskRecord = (context: MachineContext): MiningTask | null => {
	const task = getMiningTask(context.taskData)
	if (!task) {
		return null
	}

	const fail = (reason: string): MiningTask => {
		Logger.error('[TASKS] record link failed', { reason })
		return { ...task, taskId: null, lastFailure: reason }
	}

	const memory = taskMemoryOf(context)
	if (!memory) {
		return fail('Task memory is unavailable')
	}

	try {
		if (!task.taskId) {
			const record = memory.createTask({
				kind: 'mining',
				blockName: task.blockName,
				resourceName: task.resourceName,
				total: task.count
			})
			// Verify-before-mutate: a foreign, corrupt or terminal row must
			// never be activated. The flip happens only on a full echo.
			if (
				!record?.id ||
				!matchRow(record, {
					id: record.id,
					status: 'suspended',
					kind: 'mining',
					blockName: task.blockName,
					resourceName: task.resourceName,
					total: task.count,
					done: 0
				})
			) {
				return fail(`Task record mismatch after create for ${task.blockName}`)
			}
			const flipped = memory.setTaskStatus(record.id, 'active')
			if (
				!matchRow(flipped, {
					id: record.id,
					status: 'active',
					kind: 'mining',
					blockName: task.blockName,
					resourceName: task.resourceName,
					total: task.count,
					done: 0
				})
			) {
				return fail(`Task record activation failed for ${task.blockName}`)
			}
			Logger.debug(
				`[TASKS] Linked mining task to record ${record.id} (${task.blockName} x${task.count})`
			)
			return { ...task, taskId: record.id }
		}

		const record = memory.getTask(task.taskId)
		if (!record) {
			return fail(`Task record is gone: ${task.taskId}`)
		}
		if (record.id !== task.taskId) {
			return fail(
				`Task record mismatch: wanted ${task.taskId}, got ${record.id}`
			)
		}
		if (!hasValidTaskProgress(record)) {
			return fail(`Task record is corrupt: ${record.id}`)
		}
		if (!matchesTaskDefinition(record, task)) {
			return fail(`Task record payload mismatch: ${record.id}`)
		}
		if (record.status !== 'suspended' && record.status !== 'active') {
			return fail(`Task record already moved to ${record.status}: ${record.id}`)
		}

		if (record.status === 'suspended') {
			const flipped = memory.setTaskStatus(record.id, 'active')
			if (
				!matchRow(flipped, {
					id: record.id,
					status: 'active',
					kind: 'mining',
					blockName: task.blockName,
					resourceName: task.resourceName,
					total: task.count,
					done: record.done
				})
			) {
				return fail(`Task record reactivation failed: ${record.id}`)
			}
			Logger.debug(`[TASKS] Reactivated record ${record.id} on resume`)
		}
		return task
	} catch (error) {
		return fail(
			`Task record link failed: ${error instanceof Error ? error.message : String(error)}`
		)
	}
}

export const computeTaskCreate = (context: MachineContext): TaskOpOutcome => {
	const toolName = 'tasks_create'
	const args = pendingArgs(context, toolName)
	const memory = taskMemoryOf(context)
	if (!memory) {
		return failureOutcome(context, toolName, args, 'Task memory is unavailable')
	}

	const blockName = normalizeBlockName(args.block_name)
	const resourceName =
		typeof args.resource_name === 'string' ? args.resource_name : undefined
	const count = args.count
	if (!blockName || typeof count !== 'number') {
		return failureOutcome(
			context,
			toolName,
			args,
			'Task create requires block_name and count'
		)
	}

	if (!context.bot?.registry.blocksByName[blockName]) {
		return failureOutcome(
			context,
			toolName,
			args,
			`Unknown block type: ${blockName}`
		)
	}

	try {
		if (resourceName)
			resolveMiningResource(context.bot!, blockName, resourceName)
		const record = memory.createTask({
			kind: 'mining',
			blockName,
			resourceName,
			total: count
		})
		if (
			!record?.id ||
			!matchRow(record, {
				id: record.id,
				status: 'suspended',
				kind: 'mining',
				blockName,
				resourceName,
				total: count,
				done: 0
			})
		) {
			return failureOutcome(
				context,
				toolName,
				args,
				`Task record mismatch after create for ${blockName}`
			)
		}
		Logger.debug(
			`[TASKS] Created suspended record ${record.id} (${blockName} x${count})`
		)
		return successOutcome(
			context,
			toolName,
			{ ...args, task_id: record.id },
			{
				pendingExecution: null
			}
		)
	} catch (error) {
		return failureOutcome(
			context,
			toolName,
			args,
			`Task create failed: ${error instanceof Error ? error.message : String(error)}`
		)
	}
}

export const computeTaskStart = (context: MachineContext): TaskOpOutcome => {
	const toolName = 'tasks_start'
	const args = pendingArgs(context, toolName)
	const memory = taskMemoryOf(context)
	if (!memory) {
		return failureOutcome(context, toolName, args, 'Task memory is unavailable')
	}

	const taskId = typeof args.task_id === 'string' ? args.task_id : ''
	let record: PersistentTaskRecord | null = null
	try {
		record = taskId ? memory.getTask(taskId) : null
	} catch (error) {
		return failureOutcome(
			context,
			toolName,
			args,
			`Task read failed: ${error instanceof Error ? error.message : String(error)}`
		)
	}

	if (!record) {
		return failureOutcome(
			context,
			toolName,
			args,
			`Unknown task: ${taskId || '(missing id)'}`
		)
	}
	if (record.id !== taskId) {
		return failureOutcome(
			context,
			toolName,
			args,
			`Task record mismatch: wanted ${taskId}, got ${record.id}`
		)
	}

	if (
		!record.id ||
		typeof record.blockName !== 'string' ||
		record.blockName.length === 0 ||
		!Number.isInteger(record.total) ||
		record.total <= 0 ||
		!hasValidTaskProgress(record)
	) {
		return failureOutcome(
			context,
			toolName,
			args,
			`Task record is corrupt: ${record.id || '(missing id)'}`
		)
	}

	if (record.status === 'active') {
		// An active row with a live runtime owner is already running.
		// An active row WITHOUT one is orphaned (e.g. a failed terminal
		// sync): adopt it instead of bricking the task until restart.
		const runningId = taskIdOf(context)
		if (runningId === record.id) {
			return failureOutcome(
				context,
				toolName,
				args,
				`Task ${record.id} is already running`
			)
		}
		Logger.error('[TASKS] adopting orphaned active record', {
			taskId: record.id
		})
	} else if (record.status !== 'suspended') {
		return failureOutcome(
			context,
			toolName,
			args,
			`Task ${record.id} is ${record.status}, only suspended tasks can start`
		)
	}

	if (!context.bot?.registry.blocksByName[record.blockName]) {
		return failureOutcome(
			context,
			toolName,
			args,
			`Unknown block type: ${record.blockName}`
		)
	}

	try {
		if (record.resourceName)
			resolveMiningResource(context.bot!, record.blockName, record.resourceName)
		if (record.status === 'suspended') {
			const flipped = memory.setTaskStatus(record.id, 'active')
			if (
				!matchRow(flipped, {
					id: record.id,
					status: 'active',
					kind: record.kind,
					blockName: record.blockName,
					resourceName: record.resourceName,
					total: record.total,
					done: record.done
				})
			) {
				return failureOutcome(
					context,
					toolName,
					args,
					`Task record is gone: ${record.id}`
				)
			}
		}
	} catch (error) {
		return failureOutcome(
			context,
			toolName,
			args,
			`Task start failed: ${error instanceof Error ? error.message : String(error)}`
		)
	}

	Logger.debug(
		`[TASKS] Started record ${record.id} (${record.blockName} x${record.total}, done ${record.done})`
	)
	const outcome = successOutcome(context, toolName, args, {
		taskData: miningTaskFromRecord(record)
	})
	// Routing, not an outcome: the mining run that follows owns the single
	// success/failure verdict (and the consecutiveFailures reset).
	return { ...outcome, goalExecution: context.goalExecution }
}

export const computeTaskCancel = (context: MachineContext): TaskOpOutcome => {
	const toolName = 'tasks_cancel'
	const args = pendingArgs(context, toolName)
	const memory = taskMemoryOf(context)
	if (!memory) {
		return failureOutcome(context, toolName, args, 'Task memory is unavailable')
	}

	const taskId = typeof args.task_id === 'string' ? args.task_id : ''
	let record: PersistentTaskRecord | null = null
	try {
		record = taskId ? memory.getTask(taskId) : null
	} catch (error) {
		return failureOutcome(
			context,
			toolName,
			args,
			`Task read failed: ${error instanceof Error ? error.message : String(error)}`
		)
	}

	if (!record) {
		return failureOutcome(
			context,
			toolName,
			args,
			`Unknown task: ${taskId || '(missing id)'}`
		)
	}
	if (record.id !== taskId) {
		return failureOutcome(
			context,
			toolName,
			args,
			`Task record mismatch: wanted ${taskId}, got ${record.id}`
		)
	}
	if (!hasValidTaskProgress(record)) {
		return failureOutcome(
			context,
			toolName,
			args,
			`Task record is corrupt: ${record.id}`
		)
	}

	if (isTerminalTaskStatus(record.status)) {
		return failureOutcome(
			context,
			toolName,
			args,
			`Task ${record.id} is already ${record.status}`
		)
	}

	try {
		const wasActive = record.status === 'active'
		const runningId = wasActive ? taskIdOf(context) : null
		const wrote = memory.setTaskStatus(record.id, 'cancelled')
		if (
			!matchRow(wrote, {
				id: record.id,
				status: 'cancelled',
				kind: record.kind,
				blockName: record.blockName,
				resourceName: record.resourceName,
				total: record.total,
				done: record.done
			})
		) {
			return failureOutcome(
				context,
				toolName,
				args,
				`Task record is gone: ${record.id}`
			)
		}
		if (runningId === record.id) {
			return successOutcome(context, toolName, args, {
				pendingExecution: null,
				taskData: null
			})
		}
		Logger.debug(
			`[TASKS] Cancelled ${wasActive ? 'orphaned active' : 'suspended'} record ${record.id}`
		)
		return successOutcome(context, toolName, args, { pendingExecution: null })
	} catch (error) {
		return failureOutcome(
			context,
			toolName,
			args,
			`Task cancel failed: ${error instanceof Error ? error.message : String(error)}`
		)
	}
}

/**
 * Terminal gate (TASK_SYNCING): the success verdict is granted only after
 * the terminal write lands verified. A missing prerequisite, a failed
 * write, or a mismatched row marks `lastFailure` and routes to
 * TASK_SYNC_FAILED — no success lie, no silent row drift, and no terminal
 * stamp on a resumable row.
 */
export const syncTerminalRecord = (
	context: MachineContext
): MiningTask | null => {
	const task = getMiningTask(context.taskData)
	if (!task) {
		return null
	}

	const taskId = task.taskId
	const memory = taskMemoryOf(context)
	if (!taskId || !memory) {
		const reason = 'Task record unavailable for terminal sync'
		Logger.error('[TASKS] terminal sync failed', { reason })
		return { ...task, lastFailure: reason }
	}

	try {
		// A null or mismatched row is a failed sync, not a success:
		// the record may have been deleted or clobbered concurrently.
		const written = memory.updateTaskProgress(taskId, task.collected, {
			status: 'completed',
			onlyFrom: 'active'
		})
		if (
			matchRow(written, {
				id: taskId,
				status: 'completed',
				kind: 'mining',
				blockName: task.blockName,
				resourceName: task.resourceName,
				total: task.count,
				done: normalizeTaskDone(task.collected, task.count)
			})
		) {
			return { ...task, lastFailure: null }
		}
		const reason = `Task record sync failed: no completed row for ${taskId}`
		Logger.error('[TASKS] terminal sync failed', { reason })
		return { ...task, lastFailure: reason }
	} catch (error) {
		const reason = `Task record sync failed: ${error instanceof Error ? error.message : String(error)}`
		Logger.error('[TASKS] terminal sync failed', { reason })
		return { ...task, lastFailure: reason }
	}
}

export const taskRecordActions = {
	persistCompletedTask: assign<
		MachineContext,
		MachineEvent,
		undefined,
		MachineEvent,
		never
	>({
		taskData: ({ context }: { context: MachineContext }) =>
			syncTerminalRecord(context)
	}),

	persistFailedTask: ({ context }: { context: MachineContext }) => {
		const task = getMiningTask(context.taskData)
		if (task) {
			syncRecord(context, task.collected, 'failed', 'active')
		}
	},

	/**
	 * Sync after every confirmed unit of progress so a crash or actor.stop()
	 * — which skips exit actions — loses at most the in-flight block.
	 * Status is preserved and the echo is verified like any other sync;
	 * a mismatch is diagnosed but never blocks the run (the terminal gate
	 * owns the verdict).
	 */
	persistProgressTask: ({ context }: { context: MachineContext }) => {
		const task = getMiningTask(context.taskData)
		if (task) {
			syncRecord(context, task.collected, undefined, 'active')
		}
	},

	/**
	 * TASKS exit hook. Writes `suspended` only over `active` rows so terminal
	 * outcomes written by TASK_COMPLETED/TASK_FAILED are never clobbered.
	 */
	persistSuspendedTask: ({ context }: { context: MachineContext }) => {
		const task = getMiningTask(context.taskData)
		if (task) {
			syncRecord(context, task.collected, 'suspended', 'active')
		}
	}
}
