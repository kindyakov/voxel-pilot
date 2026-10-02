import { assign } from 'xstate'

import Logger from '@/config/logger.js'

import type { MachineContext } from '@/hsm/context.js'
import { resolveMiningResource } from '@/hsm/tasks/miningResource.js'
import {
	advanceToNextBlock as advanceTask,
	getMiningTask,
	recordBreakFailure as recordBreak,
	recordNavigationFailure as recordNavigation,
	refreshMiningQueue,
	sampleMiningInventory,
	storeFoundBlocks as storeBlocks
} from '@/hsm/tasks/task.js'
import type { MachineEvent } from '@/hsm/types.js'

const inventoryCount = (context: MachineContext): number => {
	const task = getMiningTask(context.taskData)
	if (!task || !context.bot) return 0
	const resource = resolveMiningResource(
		context.bot,
		task.blockName,
		task.resourceName
	)
	return context.bot.utils.countItemInInventory(resource.itemId)
}

const eventReason = (event: MachineEvent): string | null => {
	if ('reason' in event && typeof event.reason === 'string') return event.reason
	if (event.type === 'ERROR') return event.error
	return null
}

export const miningActions = {
	// Called only after the terminal persistence gate, before taskData is cleared.
	recordMiningCompletion: assign<
		MachineContext,
		MachineEvent,
		undefined,
		MachineEvent,
		never
	>(({ context }) => {
		const task = getMiningTask(context.taskData)
		if (!task || !context.bot) return {}
		const resource = resolveMiningResource(
			context.bot,
			task.blockName,
			task.resourceName
		)
		return {
			completedMiningTasks: [
				...context.completedMiningTasks,
				{
					taskId: task.taskId,
					blockName: task.blockName,
					resourceName: resource.itemName,
					requested: task.count,
					collected: task.collected
				}
			]
		}
	}),
	beginMiningInventory: assign<
		MachineContext,
		MachineEvent,
		undefined,
		MachineEvent,
		never
	>({
		taskData: ({ context }) => {
			const task = getMiningTask(context.taskData)
			if (!task) return null
			try {
				return {
					...task,
					inventoryBaseline: {
						count: inventoryCount(context),
						progress: task.collected
					}
				}
			} catch (error) {
				return {
					...task,
					inventoryBaseline: undefined,
					lastFailure: String(error)
				}
			}
		}
	}),
	refreshMiningQueue: assign<
		MachineContext,
		MachineEvent,
		undefined,
		MachineEvent,
		never
	>({
		taskData: ({ context }) => {
			const task = getMiningTask(context.taskData)
			return task && context.bot
				? refreshMiningQueue(task, block =>
						context.bot!.blockAt(block.position)
					)
				: task
		}
	}),
	entryMining: ({ context }: { context: MachineContext }) => {
		const data = getMiningTask(context.taskData)
		Logger.debug(
			`[MINING] Starting mining task: ${data?.blockName ?? 'unknown'} x${data?.count ?? 0}`
		)
	},

	exitMining: () => {
		Logger.debug('[MINING] Exiting mining state')
	},

	storeFoundBlocks: assign<
		MachineContext,
		MachineEvent,
		undefined,
		MachineEvent,
		never
	>({
		taskData: ({
			context,
			event
		}: {
			context: MachineContext
			event: MachineEvent
		}) => {
			const currentData = getMiningTask(context.taskData)
			if (event.type !== 'BLOCKS_FOUND' || !currentData) {
				return currentData
			}

			return storeBlocks(currentData, event.blocks)
		}
	}),

	advanceToNextBlock: assign<
		MachineContext,
		MachineEvent,
		undefined,
		MachineEvent,
		never
	>({
		taskData: ({ context }: { context: MachineContext }) => {
			const data = getMiningTask(context.taskData)
			if (!data) {
				return null
			}

			return advanceTask(data)
		}
	}),

	recordCollected: assign<
		MachineContext,
		MachineEvent,
		undefined,
		MachineEvent,
		never
	>({
		taskData: ({ context }: { context: MachineContext }) => {
			const data = getMiningTask(context.taskData)
			if (!data) {
				return null
			}

			if (!data.inventoryBaseline) return data
			return sampleMiningInventory(data, inventoryCount(context))
		}
	}),

	recordNavigationFailure: assign<
		MachineContext,
		MachineEvent,
		undefined,
		MachineEvent,
		never
	>({
		taskData: ({
			context,
			event
		}: {
			context: MachineContext
			event: MachineEvent
		}) => {
			const data = getMiningTask(context.taskData)
			if (!data) {
				return null
			}

			return recordNavigation(data, eventReason(event))
		}
	}),

	recordBreakFailure: assign<
		MachineContext,
		MachineEvent,
		undefined,
		MachineEvent,
		never
	>({
		taskData: ({
			context,
			event
		}: {
			context: MachineContext
			event: MachineEvent
		}) => {
			const data = getMiningTask(context.taskData)
			if (!data) {
				return null
			}

			return recordBreak(data, eventReason(event))
		}
	}),

	taskMiningCompleted: ({ context }: { context: MachineContext }) => {
		const data = getMiningTask(context.taskData)
		if (!data) {
			return
		}

		Logger.debug(
			`[MINING] Task completed: collected ${data.collected}/${data.count} ${data.blockName}`
		)
		context.bot?.chat(
			`Добыто ${data.collected} ${data.resourceName ?? data.blockName}`
		)
	},

	taskMiningFailed: ({
		context,
		event
	}: {
		context: MachineContext
		event: MachineEvent
	}) => {
		const data = getMiningTask(context.taskData)
		if (!data) {
			context.bot?.chat('Не удалось завершить добычу')
			return
		}

		const reason =
			eventReason(event) ?? data.lastFailure ?? 'неизвестная причина'
		Logger.debug(
			`[MINING] Task failed: collected ${data.collected}/${data.count} ${data.blockName}. Reason: ${reason}`
		)
		context.bot?.chat(
			`Не удалось завершить добычу ${data.blockName}. Собрано: ${data.collected}/${data.count}. Причина: ${reason}`
		)
	}
}
