import type { StopIssue, StopResult } from '@voxel-pilot/contracts'

/** Internal facts from the resource owner, independent of the public deadline. */
export interface FinalizationReport {
	readonly persistence: Exclude<StopResult['persistence'], 'incomplete'>
	readonly issues: readonly StopIssue[]
}

export function stopIssue(
	stage: StopIssue['stage'],
	code: string,
	message: string
): StopIssue {
	return Object.freeze({ stage, code, message })
}

export function freezeReport(
	persistence: FinalizationReport['persistence'],
	issues: readonly StopIssue[]
): FinalizationReport {
	return Object.freeze({ persistence, issues: Object.freeze([...issues]) })
}
