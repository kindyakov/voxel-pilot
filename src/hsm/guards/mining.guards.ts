import type { MachineContext } from '@/hsm/context'
import type { MiningTaskData } from '@/hsm/types'

const getMiningTaskData = (context: MachineContext): MiningTaskData | null =>
	(context.taskData as MiningTaskData | null) ?? null

const countPlayerInventoryEmptySlots = (context: MachineContext): number => {
	const slots = context.bot?.inventory.slots ?? []
	return slots.slice(9, 45).filter(slot => slot === null).length
}

export const miningGuards = {
	canAttemptMining: ({ context }: { context: MachineContext }) => {
		const taskData = getMiningTaskData(context)
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
		const taskData = getMiningTaskData(context)
		if (!taskData || !context.bot?.entity) {
			return false
		}

		const targetBlock = taskData.targetBlocks[taskData.targetIndex]
		if (!targetBlock?.position) {
			return false
		}

		return context.bot.entity.position.distanceTo(targetBlock.position) <= 4
	},

	isMiningGoalComplete: ({ context }: { context: MachineContext }) => {
		const taskData = getMiningTaskData(context)
		if (!taskData) {
			return false
		}

		return taskData.collected >= taskData.count
	},

	hasMoreBlocksToMine: ({ context }: { context: MachineContext }) => {
		const taskData = getMiningTaskData(context)
		if (!taskData) {
			return false
		}

		return taskData.targetIndex + 1 < taskData.targetBlocks.length
	},

	isInventoryFull: ({ context }: { context: MachineContext }) =>
		countPlayerInventoryEmptySlots(context) <= 2,

	maxNavigationAttemptsReached: ({ context }: { context: MachineContext }) => {
		const taskData = getMiningTaskData(context)
		if (!taskData) {
			return false
		}

		return taskData.navigationAttempts >= 2
	},

	maxBreakAttemptsReached: ({ context }: { context: MachineContext }) => {
		const taskData = getMiningTaskData(context)
		if (!taskData) {
			return false
		}

		return taskData.breakAttempts >= 2
	}
}
