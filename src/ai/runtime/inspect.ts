import type { Bot } from '@/types'

export type InspectBlocksScope = 'interactables' | 'resources' | 'all'

export interface RuntimePosition {
	x: number
	y: number
	z: number
}

export interface BlockInspectionFact {
	name: string
	kind: 'interactable' | 'resource'
	position: RuntimePosition
	distance: number
}

export interface EntityInspectionFact {
	label: string
	type: string
	position: RuntimePosition
	distance: number
}

const INTERACTABLE_KEYWORDS = [
	'chest',
	'trapped_chest',
	'furnace',
	'blast_furnace',
	'smoker',
	'barrel',
	'shulker_box',
	'crafting_table',
	'hopper',
	'dropper',
	'dispenser'
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

const DEFAULT_BLOCK_LIMIT = 12
const DEFAULT_ENTITY_LIMIT = 10
const DEFAULT_MAX_DISTANCE = 32

const isFiniteNumber = (value: unknown): value is number =>
	typeof value === 'number' && Number.isFinite(value)

const roundDistance = (distance: number): number =>
	Math.round(distance * 10) / 10

const toPosition = (value: unknown): RuntimePosition | null => {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return null
	}

	const candidate = value as Record<string, unknown>
	if (
		!isFiniteNumber(candidate.x) ||
		!isFiniteNumber(candidate.y) ||
		!isFiniteNumber(candidate.z)
	) {
		return null
	}

	return {
		x: candidate.x,
		y: candidate.y,
		z: candidate.z
	}
}

const isInteractableBlock = (blockName: string): boolean =>
	INTERACTABLE_KEYWORDS.some(keyword => blockName.includes(keyword))

const isResourceBlock = (blockName: string): boolean =>
	RESOURCE_KEYWORDS.some(keyword => blockName.includes(keyword))

const classifyBlockKind = (
	blockName: string
): BlockInspectionFact['kind'] | null => {
	if (isInteractableBlock(blockName)) {
		return 'interactable'
	}

	if (isResourceBlock(blockName)) {
		return 'resource'
	}

	return null
}

const isValidMaxDistance = (value: unknown): value is number =>
	isFiniteNumber(value) && value > 0

const normalizeMaxDistance = (value: unknown): number =>
	isValidMaxDistance(value) ? value : DEFAULT_MAX_DISTANCE

const normalizeLimit = (value: unknown, fallback: number): number => {
	if (!isFiniteNumber(value) || value <= 0) {
		return fallback
	}

	return Math.min(Math.floor(value), 64)
}

const matchesBlockScope = (
	scope: InspectBlocksScope,
	kind: BlockInspectionFact['kind']
): boolean => {
	if (scope === 'all') {
		return true
	}

	if (scope === 'interactables') {
		return kind === 'interactable'
	}

	return kind === 'resource'
}

const resolveEntityLabel = (
	entity: Record<string, unknown>,
	type: string
): string => {
	if (type === 'player' && typeof entity.username === 'string') {
		return entity.username
	}

	if (typeof entity.name === 'string' && entity.name.trim().length > 0) {
		return entity.name
	}

	if (typeof entity.username === 'string' && entity.username.trim().length > 0) {
		return entity.username
	}

	return type
}

export const inspectNearbyBlocks = (
	bot: Bot,
	options?: {
		scope?: InspectBlocksScope
		maxDistance?: number
		limit?: number
	}
): BlockInspectionFact[] => {
	const scope = options?.scope ?? 'all'
	const maxDistance = normalizeMaxDistance(options?.maxDistance)
	const limit = normalizeLimit(options?.limit, DEFAULT_BLOCK_LIMIT)
	const origin = toPosition(bot.entity?.position)

	if (!origin || typeof bot.findBlocks !== 'function') {
		return []
	}

	const candidates = bot.findBlocks({
		matching: (block: { name?: string }) => {
			if (!block?.name) {
				return false
			}

			const kind = classifyBlockKind(block.name)
			return Boolean(kind && matchesBlockScope(scope, kind))
		},
		maxDistance,
		count: Math.max(limit * 4, limit)
	})

	const facts = candidates
		.map(position => {
			const block = bot.blockAt(position)
			if (!block?.name || !block.position) {
				return null
			}

			const resolvedPosition = toPosition(block.position)
			if (!resolvedPosition || typeof bot.entity?.position?.distanceTo !== 'function') {
				return null
			}

			const kind = classifyBlockKind(block.name)
			if (!kind || !matchesBlockScope(scope, kind)) {
				return null
			}

			return {
				name: block.name,
				kind,
				position: resolvedPosition,
				distance: roundDistance(
					bot.entity.position.distanceTo(block.position)
				)
			} satisfies BlockInspectionFact
		})
		.filter((fact): fact is BlockInspectionFact => Boolean(fact))
		.sort((left, right) => left.distance - right.distance)

	return facts.slice(0, limit)
}

export const inspectNearbyEntities = (
	bot: Bot,
	options?: {
		maxDistance?: number
		limit?: number
	}
): EntityInspectionFact[] => {
	const maxDistance = normalizeMaxDistance(options?.maxDistance)
	const limit = normalizeLimit(options?.limit, DEFAULT_ENTITY_LIMIT)
	const origin = toPosition(bot.entity?.position)

	if (!origin || !bot.entities) {
		return []
	}

	const entityFacts = Object.values(bot.entities)
		.map(entity => {
			const resolvedPosition = toPosition(entity?.position)
			if (!resolvedPosition || typeof bot.entity?.position?.distanceTo !== 'function') {
				return null
			}

			const distance = bot.entity.position.distanceTo(entity.position)
			if (!Number.isFinite(distance) || distance > maxDistance) {
				return null
			}

			const type =
				typeof entity.type === 'string' && entity.type.trim().length > 0
					? entity.type
					: 'unknown'
			const label = resolveEntityLabel(
				entity as unknown as Record<string, unknown>,
				type
			)

			return {
				label,
				type,
				position: resolvedPosition,
				distance: roundDistance(distance)
			} satisfies EntityInspectionFact
		})
		.filter((fact): fact is EntityInspectionFact => Boolean(fact))
		.sort((left, right) => left.distance - right.distance)

	return entityFacts.slice(0, limit)
}
