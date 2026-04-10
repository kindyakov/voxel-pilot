import { assign } from 'xstate'

import type { MachineContext } from '@/hsm/context'
import type { MachineEvent, MiningTaskData } from '@/hsm/types'

const getMiningTaskData = (context: MachineContext): MiningTaskData | null =>
	(context.taskData as MiningTaskData | null) ?? null

export const miningActions = {
	entryMining: ({ context }: { context: MachineContext }) => {
		const data = getMiningTaskData(context)
		console.log(
			`[MINING] Starting mining task: ${data?.blockName ?? 'unknown'} x${data?.count ?? 0}`
		)
	},

	exitMining: () => {
		console.log('[MINING] Exiting mining state')
	},

	storeFoundBlocks: assign<MachineContext, MachineEvent, undefined, MachineEvent, never>({
		taskData: ({
			context,
			event
		}: {
			context: MachineContext
			event: MachineEvent
		}) => {
			const currentData = getMiningTaskData(context)
			if (event.type !== 'BLOCKS_FOUND') {
				return currentData
			}

			return {
				blockName: currentData?.blockName ?? '',
				count: currentData?.count ?? 1,
				targetBlocks: event.blocks,
				targetIndex: 0,
				collected: currentData?.collected ?? 0,
				navigationAttempts: currentData?.navigationAttempts ?? 0,
				breakAttempts: currentData?.breakAttempts ?? 0
			} satisfies MiningTaskData
		}
	}),

	advanceToNextBlock: assign<MachineContext, MachineEvent, undefined, MachineEvent, never>({
		taskData: ({ context }: { context: MachineContext }) => {
			const data = getMiningTaskData(context)
			if (!data) {
				return null
			}

			return {
				...data,
				targetIndex: data.targetIndex + 1
			} satisfies MiningTaskData
		}
	}),

	incrementCollected: assign<MachineContext, MachineEvent, undefined, MachineEvent, never>({
		taskData: ({ context }: { context: MachineContext }) => {
			const data = getMiningTaskData(context)
			if (!data) {
				return null
			}

			return {
				...data,
				collected: data.collected + 1
			} satisfies MiningTaskData
		}
	}),

	incrementNavigationAttempts: assign<MachineContext, MachineEvent, undefined, MachineEvent, never>({
		taskData: ({ context }: { context: MachineContext }) => {
			const data = getMiningTaskData(context)
			if (!data) {
				return null
			}

			return {
				...data,
				navigationAttempts: data.navigationAttempts + 1
			} satisfies MiningTaskData
		}
	}),

	resetNavigationAttempts: assign<MachineContext, MachineEvent, undefined, MachineEvent, never>({
		taskData: ({ context }: { context: MachineContext }) => {
			const data = getMiningTaskData(context)
			if (!data) {
				return null
			}

			return {
				...data,
				navigationAttempts: 0
			} satisfies MiningTaskData
		}
	}),

	incrementBreakAttempts: assign<MachineContext, MachineEvent, undefined, MachineEvent, never>({
		taskData: ({ context }: { context: MachineContext }) => {
			const data = getMiningTaskData(context)
			if (!data) {
				return null
			}

			return {
				...data,
				breakAttempts: data.breakAttempts + 1
			} satisfies MiningTaskData
		}
	}),

	resetBreakAttempts: assign<MachineContext, MachineEvent, undefined, MachineEvent, never>({
		taskData: ({ context }: { context: MachineContext }) => {
			const data = getMiningTaskData(context)
			if (!data) {
				return null
			}

			return {
				...data,
				breakAttempts: 0
			} satisfies MiningTaskData
		}
	}),

	taskMiningCompleted: ({ context }: { context: MachineContext }) => {
		const data = getMiningTaskData(context)
		if (!data) {
			return
		}

		console.log(
			`[MINING] Task completed: collected ${data.collected}/${data.count} ${data.blockName}`
		)
		context.bot?.chat(`Добыто ${data.collected} ${data.blockName}`)
	},

	taskMiningFailed: ({ context }: { context: MachineContext }) => {
		const data = getMiningTaskData(context)
		if (!data) {
			context.bot?.chat('Не удалось завершить добычу')
			return
		}

		console.log(
			`[MINING] Task failed: collected ${data.collected}/${data.count} ${data.blockName}`
		)
		context.bot?.chat(
			`Не удалось завершить добычу ${data.blockName}. Собрано: ${data.collected}/${data.count}`
		)
	}
}
