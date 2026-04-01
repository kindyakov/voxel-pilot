export type TaskCategory =
	| 'craft'
	| 'smelt'
	| 'place'
	| 'navigate'
	| 'follow'
	| 'gather'
	| 'unknown'

export interface TaskContext {
	category: TaskCategory
	relevantInteractables: string[]
	recentFacts: string[]
	rejectedStepSignatures: string[]
}

const CRAFT_KEYWORDS = [
	'craft',
	'make',
	'создай',
	'сделай',
	'скрафти',
	'изготов'
]

const SMELT_KEYWORDS = ['smelt', 'переплав', 'плав']
const PLACE_KEYWORDS = ['place', 'постав', 'установ']
const FOLLOW_KEYWORDS = ['follow', 'следуй', 'иди за']
const NAVIGATE_KEYWORDS = ['go to', 'come to', 'иди к', 'подойди', 'navigate']
const GATHER_KEYWORDS = ['collect', 'gather', 'mine', 'добуд', 'собери', 'накопай']

const includesAny = (value: string, keywords: string[]): boolean =>
	keywords.some(keyword => value.includes(keyword))

const inferTaskCategory = (
	currentGoal: string | null,
	subGoal: string | null
): TaskCategory => {
	const source = `${currentGoal ?? ''} ${subGoal ?? ''}`.toLowerCase()

	if (includesAny(source, SMELT_KEYWORDS)) return 'smelt'
	if (includesAny(source, PLACE_KEYWORDS)) return 'place'
	if (includesAny(source, FOLLOW_KEYWORDS)) return 'follow'
	if (includesAny(source, GATHER_KEYWORDS)) return 'gather'
	if (includesAny(source, CRAFT_KEYWORDS)) return 'craft'
	if (includesAny(source, NAVIGATE_KEYWORDS)) return 'navigate'

	return 'unknown'
}

const getRelevantInteractables = (category: TaskCategory): string[] => {
	switch (category) {
		case 'craft':
			return ['crafting_table']
		case 'smelt':
			return ['furnace', 'blast_furnace', 'smoker']
		default:
			return []
	}
}

const trimFacts = (facts: string[]): string[] => facts.slice(-5)
const trimRejected = (signatures: string[]): string[] => signatures.slice(-5)

export const createTaskContext = (
	currentGoal: string | null,
	subGoal: string | null
): TaskContext => {
	const category = inferTaskCategory(currentGoal, subGoal)

	return {
		category,
		relevantInteractables: getRelevantInteractables(category),
		recentFacts: [],
		rejectedStepSignatures: []
	}
}

export const refreshTaskContext = (
	taskContext: TaskContext,
	currentGoal: string | null,
	subGoal: string | null
): TaskContext => {
	const next = createTaskContext(currentGoal, subGoal)

	return {
		...next,
		recentFacts: trimFacts(taskContext.recentFacts),
		rejectedStepSignatures: trimRejected(taskContext.rejectedStepSignatures)
	}
}

export const appendTaskFact = (
	taskContext: TaskContext,
	fact: string | null
): TaskContext => {
	if (!fact) {
		return taskContext
	}

	return {
		...taskContext,
		recentFacts: trimFacts([...taskContext.recentFacts, fact])
	}
}

export const appendRejectedStepSignature = (
	taskContext: TaskContext,
	signature: string
): TaskContext => ({
	...taskContext,
	rejectedStepSignatures: trimRejected([
		...taskContext.rejectedStepSignatures,
		signature
	])
})

export const getTaskFactFromExecution = (
	toolName: string | null,
	args: Record<string, unknown> | null,
	result: 'SUCCESS' | 'FAILED' | null,
	reason: string | null
): string | null => {
	if (!toolName) {
		return null
	}

	if (result === 'SUCCESS') {
		switch (toolName) {
			case 'break_block':
				return typeof args?.position === 'object'
					? 'resource_step_succeeded'
					: 'break_step_succeeded'
			case 'place_block':
				return `placed:${String(args?.block_name ?? 'unknown')}`
			case 'navigate_to':
				return 'navigation_step_succeeded'
			case 'follow_entity':
				return 'follow_step_succeeded'
		}
	}

	if (result === 'FAILED' && reason) {
		return `failed:${toolName}:${reason}`
	}

	return null
}
