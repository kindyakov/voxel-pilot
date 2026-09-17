/** Pure policy for one goal; HSM owns effects and applies each outcome once. */
export interface GoalExecutionState {
	readonly attempts: number
	readonly consecutiveFailures: number
	readonly lastFailure: string | null
}

type GoalExecutionEvent =
	| { type: 'started' }
	| { type: 'succeeded' }
	| { type: 'interrupted' }
	| { type: 'rejected'; reason: string }
	| { type: 'failed'; reason: string }
	| { type: 'transport_failed'; reason: string }

export const createGoalExecution = (): GoalExecutionState => ({
	attempts: 0,
	consecutiveFailures: 0,
	lastFailure: null
})

export const advanceGoalExecution = (
	state: GoalExecutionState,
	event: GoalExecutionEvent
): GoalExecutionState => {
	if (event.type === 'interrupted' || event.type === 'transport_failed')
		return state
	if (event.type === 'started')
		return { ...state, attempts: state.attempts + 1 }
	if (event.type === 'succeeded') {
		return { ...state, consecutiveFailures: 0, lastFailure: null }
	}
	return {
		...state,
		consecutiveFailures: state.consecutiveFailures + 1,
		lastFailure: event.reason
	}
}

export const getGoalStopReason = (state: GoalExecutionState): string | null => {
	if (state.attempts >= 128) {
		return 'Останавливаю цель: исчерпан лимит действий без завершения цели.'
	}
	return state.consecutiveFailures >= 3
		? `Останавливаю цель после повторных неудач: ${state.lastFailure}`
		: null
}
