import type { Block } from '@/types/index.js'

import {
	type PersistentTaskRecord,
	normalizeTaskDone
} from '@/core/memory/types.js'

/**
 * Centralized progress of long-running tasks (Q7b).
 *
 * Ownership split: this module owns task *data* as pure transitions.
 * The HSM owns *effects* (movement, digging, chat). The pilot only picks
 * the next action. No scheduler, no queue: one active task per goal.
 * The union grows here — `| FarmingTask` arrives with the farming use case.
 */
export interface MiningTask {
	kind: 'mining'
	/** Link to the persistent record (`bot_tasks`), null when memory is unavailable (tests). */
	taskId: string | null
	blockName: string
	resourceName?: string
	/** Baseline exists only during one active mining segment, never across a pause. */
	inventoryBaseline?: { count: number; progress: number }
	count: number
	targetBlocks: Block[]
	targetIndex: number
	collected: number
	/** Attempts against the current target block (Q3: per-block budget). */
	navigationAttempts: number
	breakAttempts: number
	/** SEARCHING rounds consumed by this task (global cap). */
	totalSearches: number
	/** Position keys that failed navigation/breaking and must be skipped. */
	blacklist: string[]
	lastFailure: string | null
}

export type TaskState = MiningTask

export const positionKey = (position: {
	x: number
	y: number
	z: number
}): string =>
	`${Math.floor(position.x)}:${Math.floor(position.y)}:${Math.floor(position.z)}`

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null

export const isMiningTask = (value: unknown): value is MiningTask =>
	isRecord(value) &&
	value.kind === 'mining' &&
	(value.taskId === null || typeof value.taskId === 'string') &&
	typeof value.blockName === 'string' &&
	(value.resourceName === undefined ||
		(typeof value.resourceName === 'string' &&
			value.resourceName.length > 0)) &&
	(value.inventoryBaseline === undefined ||
		(isRecord(value.inventoryBaseline) &&
			typeof value.inventoryBaseline.count === 'number' &&
			Number.isInteger(value.inventoryBaseline.count) &&
			value.inventoryBaseline.count >= 0 &&
			typeof value.inventoryBaseline.progress === 'number' &&
			Number.isInteger(value.inventoryBaseline.progress) &&
			value.inventoryBaseline.progress >= 0)) &&
	typeof value.count === 'number' &&
	Array.isArray(value.targetBlocks) &&
	typeof value.targetIndex === 'number' &&
	typeof value.collected === 'number' &&
	typeof value.navigationAttempts === 'number' &&
	typeof value.breakAttempts === 'number' &&
	typeof value.totalSearches === 'number' &&
	Array.isArray(value.blacklist) &&
	(value.lastFailure === null || typeof value.lastFailure === 'string')

/** Validated read of context taskData. Never throws, never casts blindly (Q8). */
export const getMiningTask = (taskData: unknown): MiningTask | null =>
	isMiningTask(taskData) ? taskData : null

export const createMiningTask = (
	blockName: string,
	count: number,
	taskId: string | null = null,
	resourceName?: string
): MiningTask => ({
	kind: 'mining',
	taskId,
	blockName,
	...(resourceName ? { resourceName } : {}),
	count,
	targetBlocks: [],
	targetIndex: 0,
	collected: 0,
	navigationAttempts: 0,
	breakAttempts: 0,
	totalSearches: 0,
	blacklist: [],
	lastFailure: null
})

export const currentTarget = (task: MiningTask): Block | undefined =>
	task.targetBlocks[task.targetIndex]

/** Discard stale/unknown queue entries without blacklisting or restarting search. */
export function refreshMiningQueue(
	task: MiningTask,
	readBlock: (block: Block) => Block | null
): MiningTask {
	const remaining = task.targetBlocks.slice(task.targetIndex)
	while (remaining.length > 0) {
		const expected = remaining[0]!
		const actual = readBlock(expected)
		if (actual?.name === expected.name) {
			remaining[0] = actual
			break
		}
		remaining.shift()
	}
	return { ...task, targetBlocks: remaining, targetIndex: 0 }
}

export function sampleMiningInventory(
	task: MiningTask,
	count: number
): MiningTask {
	const baseline = task.inventoryBaseline
	if (!baseline)
		return { ...task, inventoryBaseline: { count, progress: task.collected } }
	return {
		...task,
		collected: Math.max(0, baseline.progress + count - baseline.count)
	}
}

/** Lift a suspended persistent record into a runnable task (tasks_start/resume). */
export const miningTaskFromRecord = (
	record: Pick<
		PersistentTaskRecord,
		'id' | 'blockName' | 'resourceName' | 'total' | 'done'
	>
): MiningTask => ({
	kind: 'mining',
	taskId: record.id,
	blockName: record.blockName,
	...(record.resourceName ? { resourceName: record.resourceName } : {}),
	count: record.total,
	targetBlocks: [],
	targetIndex: 0,
	collected: normalizeTaskDone(record.done, record.total),
	navigationAttempts: 0,
	breakAttempts: 0,
	totalSearches: 0,
	blacklist: [],
	lastFailure: null
})

const blockKey = (block: Block): string | null => {
	const position = (block as { position?: unknown }).position
	if (!isRecord(position)) return null
	const { x, y, z } = position
	if (typeof x !== 'number' || typeof y !== 'number' || typeof z !== 'number')
		return null
	return positionKey({ x, y, z })
}

/** Store fresh search results: drop blacklisted positions, restart index, count the round. */
export const storeFoundBlocks = (
	task: MiningTask,
	blocks: Block[]
): MiningTask => {
	const denied = new Set(task.blacklist)
	return {
		...task,
		targetBlocks: blocks.filter(block => {
			const key = blockKey(block)
			return key === null || !denied.has(key)
		}),
		targetIndex: 0,
		totalSearches: task.totalSearches + 1
	}
}

/** Move to the next block in the current list with a fresh per-block budget. */
export const advanceToNextBlock = (task: MiningTask): MiningTask => ({
	...task,
	targetIndex: task.targetIndex + 1,
	navigationAttempts: 0,
	breakAttempts: 0
})

const withFailure = (
	task: MiningTask,
	reason: string | null,
	field: 'navigationAttempts' | 'breakAttempts'
): MiningTask => {
	const target = currentTarget(task)
	const key = target ? blockKey(target) : null
	return {
		...task,
		[field]: task[field] + 1,
		blacklist:
			key !== null && !task.blacklist.includes(key)
				? [...task.blacklist, key]
				: task.blacklist,
		lastFailure: reason ?? task.lastFailure
	}
}

export const recordNavigationFailure = (
	task: MiningTask,
	reason: string | null
): MiningTask => withFailure(task, reason, 'navigationAttempts')

export const recordBreakFailure = (
	task: MiningTask,
	reason: string | null
): MiningTask => withFailure(task, reason, 'breakAttempts')
