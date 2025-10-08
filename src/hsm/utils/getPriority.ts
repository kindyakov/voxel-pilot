import { PRIORITIES } from '@hsm/config/priorities.js'
import type { MachineContext } from '@hsm/context'

type ParamsStateValue = string | Record<string, string | Record<string, string>>

export const getStatePriority = (stateName: string): number =>
	(PRIORITIES[stateName as keyof typeof PRIORITIES] as number | undefined) ?? 1

export const getCurrentPriority = (stateValue: ParamsStateValue) => {
	const activeStates = extractActiveStates(stateValue)
	const priorities = activeStates
		.map(stateName => getStatePriority(stateName))
		.filter(p => p > 0)

	return Math.max(...priorities, 1)
}

const extractActiveStates = (stateValue: ParamsStateValue): string[] => {
	const states: string[] = []

	const traverse = (
		value: string | Record<string, string | Record<string, string>>
	) => {
		if (typeof value === 'string') {
			states.push(value)
		} else if (typeof value === 'object') {
			Object.values(value).forEach(traverse)
		}
	}

	traverse(stateValue)
	return states
}

export function getHigherPriorityConditions(
	context: MachineContext,
	stateName: string
): boolean {
	if (!context.bot?.hsm) return false

	const currentState = context.bot!.hsm.getCurrentStateString()
	const currentPriority = getCurrentPriority(currentState)
	const targetPriority = getStatePriority(stateName)

	return targetPriority >= currentPriority
}
