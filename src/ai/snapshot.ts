import type { TaskContext } from './taskContext.js'

const INTERACTABLE_KEYWORDS = [
	'chest',
	'trapped_chest',
	'furnace',
	'blast_furnace',
	'smoker',
	'barrel',
	'shulker_box',
	'crafting_table'
] as const

const RESOURCE_KEYWORDS = [
	'_log',
	'_stem',
	'_ore',
	'ancient_debris',
	'wheat',
	'carrots',
	'potatoes',
	'beetroots',
	'melon',
	'pumpkin',
	'sugar_cane',
	'bamboo',
	'cactus'
] as const

const DEFAULT_LIMITS: {
	interactables: number
	resources: number
	entities: number
	errorHistory: number
} = {
	interactables: 6,
	resources: 6,
	entities: 8,
	errorHistory: 3
}

type VecLike = {
	x: number
	y: number
	z: number
	distanceTo(other: { x: number; y: number; z: number }): number
}

type ItemLike = {
	name: string
	count: number
	maxDurability?: number
	durabilityUsed?: number
}

type BlockLike = {
	name: string
	position: VecLike
	biome?: {
		name?: string
	}
}

type EntityLike = {
	type?: string
	name?: string
	username?: string
	position: VecLike
}

type SnapshotBot = {
	health: number
	food: number
	oxygenLevel: number
	entity: {
		position: VecLike
	}
	game?: {
		dimension?: string
	}
	time?: {
		isDay?: boolean
	}
	inventory: {
		slots: Array<ItemLike | null>
		items(): ItemLike[]
	}
	getEquipmentDestSlot(
		destination: 'hand' | 'off-hand' | 'head' | 'torso' | 'legs' | 'feet'
	): number
	blockAt(position: { x: number; y: number; z: number }): BlockLike | null
	findBlocks(options: {
		matching: (block: BlockLike) => boolean
		maxDistance?: number
		count?: number
	}): Array<{ x: number; y: number; z: number }>
	entities?: Record<string, EntityLike>
}

interface BuildSnapshotInput {
	bot: SnapshotBot
	currentGoal: string | null
	subGoal: string | null
	taskContext?: TaskContext | null
	lastAction: string | null
	actionResult: 'SUCCESS' | 'FAILED' | null
	reason: string | null
	errorHistory: string[]
	limits?: Partial<typeof DEFAULT_LIMITS>
}

const isDamageable = (
	item: ItemLike | null | undefined
): item is ItemLike & { maxDurability: number; durabilityUsed: number } =>
	Boolean(
		item &&
			typeof item.maxDurability === 'number' &&
			item.maxDurability > 0 &&
			typeof item.durabilityUsed === 'number'
	)

const formatDurability = (item: ItemLike | null | undefined): string => {
	if (!isDamageable(item)) {
		return ''
	}

	const remaining = Math.max(
		0,
		Math.round((1 - item.durabilityUsed / item.maxDurability) * 100)
	)

	return ` (${remaining}%)`
}

const formatInventoryItem = (item: ItemLike | null | undefined): string => {
	if (!item) {
		return 'empty'
	}

	return `${item.name} x${item.count}${formatDurability(item)}`
}

const formatEquipmentItem = (item: ItemLike | null | undefined): string => {
	if (!item) {
		return 'empty'
	}

	return `${item.name}${formatDurability(item)}`
}

const formatPosition = (position: {
	x: number
	y: number
	z: number
}): string => `${position.x},${position.y},${position.z}`

const roundDistance = (distance: number): string => distance.toFixed(1)

const isInteractable = (blockName: string): boolean =>
	INTERACTABLE_KEYWORDS.some(keyword => blockName.includes(keyword))

const isResource = (blockName: string): boolean =>
	RESOURCE_KEYWORDS.some(keyword => blockName.includes(keyword))

const getFreeSlots = (bot: SnapshotBot): number => {
	const inventorySlots = bot.inventory.slots.slice(9, 45)
	const occupiedFromSlots = inventorySlots.filter(Boolean).length
	const occupiedFromItems = bot.inventory.items().length
	const occupied = Math.max(occupiedFromSlots, occupiedFromItems)
	return Math.max(0, 36 - occupied)
}

const describeEntity = (entity: EntityLike, origin: VecLike): string => {
	const baseName =
		entity.type === 'player' && entity.username
			? `player:${entity.username}`
			: (entity.name ?? entity.type ?? 'unknown')

	return `${baseName} @ ${roundDistance(origin.distanceTo(entity.position))} -> ${formatPosition(entity.position)}`
}

const describeBlock = (block: BlockLike, origin: VecLike): string =>
	`${block.name} @ ${roundDistance(origin.distanceTo(block.position))} -> ${formatPosition(block.position)}`

export const buildSnapshot = (input: BuildSnapshotInput): string => {
	const { bot } = input
	const limits = {
		...DEFAULT_LIMITS,
		...input.limits
	}
	const origin = bot.entity.position
	const currentBlock = bot.blockAt(origin)
	const foundBlocks = bot.findBlocks({
		matching: block => isInteractable(block.name) || isResource(block.name),
		maxDistance: 32,
		count: 32
	})
	const resolvedBlocks = foundBlocks
		.map(position => bot.blockAt(position))
		.filter((block): block is BlockLike => Boolean(block))
		.sort(
			(left, right) =>
				origin.distanceTo(left.position) - origin.distanceTo(right.position)
		)

	const interactables = resolvedBlocks
		.filter(block => isInteractable(block.name))
	const relevantInteractables =
		input.taskContext?.relevantInteractables.length
			? interactables.filter(block =>
					input.taskContext!.relevantInteractables.some(keyword =>
						block.name.includes(keyword)
					)
				)
			: interactables
	const visibleInteractables = (
		relevantInteractables.length > 0 ? relevantInteractables : interactables
	).slice(0, limits.interactables)
	const resources = resolvedBlocks
		.filter(block => isResource(block.name))
		.slice(0, limits.resources)
	const entities = Object.values(bot.entities ?? {})
		.sort(
			(left, right) =>
				origin.distanceTo(left.position) - origin.distanceTo(right.position)
		)
		.slice(0, limits.entities)

	const equipmentSlots: Array<{
		label: string
		destination: 'hand' | 'off-hand' | 'head' | 'torso' | 'legs' | 'feet'
	}> = [
		{ label: 'main_hand', destination: 'hand' },
		{ label: 'off_hand', destination: 'off-hand' },
		{ label: 'head', destination: 'head' },
		{ label: 'torso', destination: 'torso' },
		{ label: 'legs', destination: 'legs' },
		{ label: 'feet', destination: 'feet' }
	]

	const equipmentLines = equipmentSlots.map(({ label, destination }) => {
		const slot = bot.getEquipmentDestSlot(destination)
		return `${label}: ${formatEquipmentItem(bot.inventory.slots[slot])}`
	})

	const itemsLine = bot.inventory.items().length
		? bot.inventory.items().map(formatInventoryItem).join(' | ')
		: '-'

	const cappedErrorHistory = input.errorHistory.slice(0, limits.errorHistory)
	const errorLine = cappedErrorHistory.length
		? cappedErrorHistory.join(' | ')
		: '-'

	return [
		'STATUS',
		`health: ${bot.health}/20`,
		`food: ${bot.food}/20`,
		`oxygen: ${bot.oxygenLevel}/20`,
		`position: ${formatPosition(origin)}`,
		`dimension: ${bot.game?.dimension ?? 'unknown'}`,
		`biome: ${currentBlock?.biome?.name ?? 'unknown'}`,
		`time: ${bot.time?.isDay ? 'day' : 'night'}`,
		'',
		'INVENTORY_EQUIPMENT',
		`free_slots: ${getFreeSlots(bot)}`,
		`items: ${itemsLine}`,
		...equipmentLines,
		'',
		'ENVIRONMENT',
		`interactables: ${visibleInteractables.length ? visibleInteractables.map(block => describeBlock(block, origin)).join(' | ') : '-'}`,
		`resources: ${resources.length ? resources.map(block => describeBlock(block, origin)).join(' | ') : '-'}`,
		`entities: ${entities.length ? entities.map(entity => describeEntity(entity, origin)).join(' | ') : '-'}`,
		'',
		'GOAL_CONTEXT',
		`current_goal: ${input.currentGoal ?? '-'}`,
		`sub_goal: ${input.subGoal ?? '-'}`,
		`task_category: ${input.taskContext?.category ?? 'unknown'}`,
		`recent_facts: ${input.taskContext?.recentFacts.length ? input.taskContext.recentFacts.join(' | ') : '-'}`,
		'',
		'FEEDBACK_ERRORS',
		`last_action: ${input.lastAction ?? '-'}`,
		`action_result: ${input.actionResult ?? '-'}`,
		`reason: ${input.reason ?? '-'}`,
		`error_history: ${errorLine}`
	].join('\n')
}
