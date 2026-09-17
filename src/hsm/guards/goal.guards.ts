import type { MachineContext } from '@/hsm/context'
import { getActorError, getActorEventProperty } from '@/hsm/utils/actorEvent'

import { classifyApiError } from '@/ai/client/retry.js'

interface GoalGuardParams {
	context: MachineContext
	event: unknown
}

const getThinkingOutputProperty = (
	event: unknown,
	property: string
): unknown => {
	const output = getActorEventProperty(event, 'output')
	return getActorEventProperty(output, property)
}

export const goalGuards = {
	canResumePausedGoal: ({ context }: GoalGuardParams) =>
		Boolean(context.pausedGoal) && context.aiPilotEnabled,
	thinkingProducedTransportFailure: ({ event }: GoalGuardParams) =>
		getThinkingOutputProperty(event, 'kind') === 'failed' &&
		getThinkingOutputProperty(event, 'isTransport') === true,
	thinkingErrorWasAbort: ({ event }: GoalGuardParams) =>
		classifyApiError(getActorError(event)).kind === 'abort',
	thinkingErrorWasTransport: ({ event }: GoalGuardParams) =>
		classifyApiError(getActorError(event)).kind === 'transport'
}
