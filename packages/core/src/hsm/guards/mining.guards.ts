import type { MachineContext } from '@/hsm/context.js'
import { resolveMiningResource } from '@/hsm/tasks/miningResource.js'
import { getMiningTask, sampleMiningInventory } from '@/hsm/tasks/task.js'

const countPlayerInventoryEmptySlots = (context: MachineContext): number => {
	const slots = context.bot?.inventory.slots ?? []
	return slots.slice(9, 45).filter(slot => slot === null).length
}

const isMiningComplete = (context: MachineContext): boolean => {
	const taskData = getMiningTask(context.taskData)
	return taskData !== null && taskData.collected >= taskData.count
}

const liveMiningTask = (context: MachineContext) => {
	const task = getMiningTask(context.taskData)
	if (!task?.inventoryBaseline || !context.bot) return null
	const resource = resolveMiningResource(
		context.bot,
		task.blockName,
		task.resourceName
	)
	return sampleMiningInventory(
		task,
		context.bot.utils.countItemInInventory(resource.itemId)
	)
}

export const miningGuards = {
	miningInventoryChanged: ({ context }: { context: MachineContext }) => {
		const live = liveMiningTask(context)
		return (
			live !== null &&
			live.collected !== getMiningTask(context.taskData)?.collected
		)
	},
	miningInventoryGoalReached: ({ context }: { context: MachineContext }) => {
		const live = liveMiningTask(context)
		return live !== null && live.collected >= live.count
	},
	miningSetupFailed: ({ context }: { context: MachineContext }) =>
		getMiningTask(context.taskData)?.inventoryBaseline === undefined,
	hasMiningTarget: ({ context }: { context: MachineContext }) => {
		const task = getMiningTask(context.taskData)
		return !!task?.targetBlocks[task.targetIndex]
	},
	canAttemptMining: ({ context }: { context: MachineContext }) => {
		const taskData = getMiningTask(context.taskData)
		if (!taskData || !context.bot) {
			return false
		}

		const blockData = context.bot.registry.blocksByName[taskData.blockName]
		if (!blockData) {
			return false
		}

		return taskData.count > 0 && countPlayerInventoryEmptySlots(context) > 2
	},

	isBlockNearby: ({ context }: { context: MachineContext }) => {
		const taskData = getMiningTask(context.taskData)
		if (!taskData || !context.bot?.entity) {
			return false
		}

		const targetBlock = taskData.targetBlocks[taskData.targetIndex]
		if (!targetBlock?.position) {
			return false
		}

		return context.bot.entity.position.distanceTo(targetBlock.position) <= 4
	},

	isMiningGoalComplete: ({ context }: { context: MachineContext }) =>
		isMiningComplete(context),

	hasMoreBlocksToMine: ({ context }: { context: MachineContext }) => {
		const taskData = getMiningTask(context.taskData)
		if (!taskData) {
			return false
		}

		return taskData.targetIndex + 1 < taskData.targetBlocks.length
	},

	isInventoryFull: ({ context }: { context: MachineContext }) =>
		countPlayerInventoryEmptySlots(context) <= 2,

	maxNavigationAttemptsReached: ({ context }: { context: MachineContext }) => {
		const taskData = getMiningTask(context.taskData)
		if (!taskData) {
			return false
		}

		return (
			taskData.navigationAttempts >= context.preferences.miningMaxBlockAttempts
		)
	},

	maxBreakAttemptsReached: ({ context }: { context: MachineContext }) => {
		const taskData = getMiningTask(context.taskData)
		if (!taskData) {
			return false
		}

		return taskData.breakAttempts >= context.preferences.miningMaxBlockAttempts
	},

	maxTotalSearchesReached: ({ context }: { context: MachineContext }) => {
		const taskData = getMiningTask(context.taskData)
		if (!taskData) {
			return false
		}

		return taskData.totalSearches >= context.preferences.miningMaxTotalSearches
	},

	/** Suspended mining progress that survives combat/survival preemption (Q4). */
	hasSuspendedMiningTask: ({ context }: { context: MachineContext }) =>
		getMiningTask(context.taskData) !== null && context.currentGoal !== null,

	/** A successful tasks_start produced resumable mining work. */
	taskStartReady: ({ context }: { context: MachineContext }) =>
		context.lastResult === 'SUCCESS' &&
		getMiningTask(context.taskData) !== null,

	/** A successfully adopted record was already complete and needs only sync. */
	taskStartComplete: ({ context }: { context: MachineContext }) =>
		context.lastResult === 'SUCCESS' && isMiningComplete(context),

	/**
	 * The MINING entry hook could not link a persistent row: the task must
	 * fail before digging, never run unlinked.
	 */
	missingTaskRecord: ({ context }: { context: MachineContext }) =>
		getMiningTask(context.taskData)?.taskId == null,

	/** The terminal write in TASK_SYNCING failed; success is not granted. */
	taskRecordSyncFailed: ({ context }: { context: MachineContext }) =>
		(getMiningTask(context.taskData)?.lastFailure ?? null) !== null
}
