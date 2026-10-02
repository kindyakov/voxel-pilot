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
const GATHER_KEYWORDS = [
	'collect',
	'gather',
	'mine',
	'добуд',
	'собери',
	'накопай'
]

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

export const createTaskContext = (
	currentGoal: string | null,
	subGoal: string | null
): TaskContext => ({ category: inferTaskCategory(currentGoal, subGoal) })
