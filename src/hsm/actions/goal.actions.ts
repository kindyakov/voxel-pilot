import { assign } from 'xstate'

import type { MachineContext } from '@/hsm/context.js'
import type { MachineEvent } from '@/hsm/types.js'
import { getActorError } from '@/hsm/utils/actorEvent.js'

import { advanceGoalExecution } from '@/ai/goalExecution.js'
import { createTaskContext } from '@/ai/taskContext.js'

const getErrorReason = (event: unknown): string => {
	const error = getActorError(event)
	return error instanceof Error ? error.message : String(error)
}

const storeThinkingError = (transportFailure: boolean) =>
	assign<MachineContext, MachineEvent, undefined, MachineEvent, never>(
		({ context, event }) => {
			const reason = getErrorReason(event)
			return {
				lastResult: 'FAILED',
				lastReason: reason,
				pendingExecution: null,
				errorHistory: [...context.errorHistory, reason].slice(-3),
				goalExecution: advanceGoalExecution(
					context.goalExecution,
					transportFailure
						? { type: 'transport_failed', reason }
						: { type: 'failed', reason }
				)
			}
		}
	)

export const goalActions = {
	pauseCurrentGoal: assign<
		MachineContext,
		MachineEvent,
		undefined,
		MachineEvent,
		never
	>(({ context }) => ({
		currentGoal: null,
		pausedGoal: context.currentGoal ?? context.pausedGoal,
		subGoal: null,
		taskContext: createTaskContext(null, null),
		pendingExecution: null
	})),
	resumePausedGoal: assign<
		MachineContext,
		MachineEvent,
		undefined,
		MachineEvent,
		never
	>(({ context }) =>
		context.pausedGoal
			? {
					currentGoal: context.pausedGoal,
					pausedGoal: null,
					subGoal: null,
					taskContext: createTaskContext(context.pausedGoal, null),
					pendingExecution: null,
					lastToolTranscript: []
				}
			: {}
	),
	storeThinkingError: storeThinkingError(false),
	storeTransportThinkingError: storeThinkingError(true)
}
