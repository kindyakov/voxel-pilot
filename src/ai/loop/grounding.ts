import type { InlineToolName } from '../contracts/execution.js'

type GroundedPositionCapability =
	| 'navigate_to'
	| 'break_block'
	| 'open_window'
	| 'place_block'
type GroundedEntitySource = 'inspect_entities'
type GroundedReferenceIndex<TSource extends string> = Map<string, Set<TSource>>

export type GroundedTurnFacts = {
	positionCapabilities: GroundedReferenceIndex<GroundedPositionCapability>
	entityNames: GroundedReferenceIndex<GroundedEntitySource>
	entityTypes: GroundedReferenceIndex<GroundedEntitySource>
	entityNameTypePairs: Set<string>
}

export const createGroundedTurnFacts = (): GroundedTurnFacts => ({
	positionCapabilities: new Map<string, Set<GroundedPositionCapability>>(),
	entityNames: new Map<string, Set<GroundedEntitySource>>(),
	entityTypes: new Map<string, Set<GroundedEntitySource>>(),
	entityNameTypePairs: new Set<string>()
})

const addGroundedReference = <TSource extends string>(
	index: GroundedReferenceIndex<TSource>,
	value: string,
	source: TSource
): boolean => {
	const existingSources = index.get(value)
	if (existingSources) {
		const sizeBefore = existingSources.size
		existingSources.add(source)
		return existingSources.size > sizeBefore
	}

	index.set(value, new Set([source]))
	return true
}

export const hasGroundedReferences = (facts: GroundedTurnFacts): boolean =>
	facts.positionCapabilities.size > 0 ||
	facts.entityNames.size > 0 ||
	facts.entityTypes.size > 0

export const isRecord = (value: unknown): value is Record<string, unknown> =>
	Boolean(value) && typeof value === 'object' && !Array.isArray(value)

export const normalizeFactValue = (value: unknown): string | null => {
	if (typeof value !== 'string') {
		return null
	}

	const normalized = value.trim().toLowerCase()
	return normalized.length > 0 ? normalized : null
}

export const entityNameTypePairKey = (name: string, type: string): string =>
	`${name}\u0000${type}`

export const tryParsePosition = (
	value: unknown
): { x: number; y: number; z: number } | null => {
	if (!isRecord(value)) {
		return null
	}

	const x = Number(value.x)
	const y = Number(value.y)
	const z = Number(value.z)
	if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
		return null
	}

	return { x, y, z }
}

const positionKey = (position: { x: number; y: number; z: number }): string =>
	`${position.x}:${position.y}:${position.z}`

const addPositionCapability = (
	facts: GroundedTurnFacts,
	position: { x: number; y: number; z: number },
	capability: GroundedPositionCapability
): boolean =>
	addGroundedReference(
		facts.positionCapabilities,
		positionKey(position),
		capability
	)

export const hasPositionCapability = (
	facts: GroundedTurnFacts,
	position: { x: number; y: number; z: number },
	capability: GroundedPositionCapability
): boolean =>
	Boolean(
		facts.positionCapabilities.get(positionKey(position))?.has(capability)
	)

export const hasAnyPositionCapability = (
	facts: GroundedTurnFacts,
	position: { x: number; y: number; z: number }
): boolean => Boolean(facts.positionCapabilities.get(positionKey(position)))

const WINDOW_MEMORY_KEYWORDS = [
	'container',
	'window',
	'chest',
	'barrel',
	'shulker',
	'furnace',
	'smoker',
	'blast_furnace',
	'blast furnace',
	'crafting_table',
	'crafting table',
	'hopper',
	'dropper',
	'dispenser'
]

const hasWindowKeyword = (value: string): boolean =>
	WINDOW_MEMORY_KEYWORDS.some(keyword => value.includes(keyword))

const isWindowCompatibleMemoryEntry = (
	entry: Record<string, unknown>
): boolean => {
	const type = normalizeFactValue(entry.type)
	if (type !== 'container' && type !== 'location') {
		return false
	}

	if (type === 'container') {
		return true
	}

	const tags = Array.isArray(entry.tags)
		? entry.tags
				.map(normalizeFactValue)
				.filter((tag): tag is string => Boolean(tag))
		: []
	const description = normalizeFactValue(entry.description)
	const data = isRecord(entry.data) ? entry.data : null
	const dataHints = [
		normalizeFactValue(data?.interactable),
		normalizeFactValue(data?.kind),
		normalizeFactValue(data?.blockName),
		normalizeFactValue(data?.block_name),
		normalizeFactValue(data?.containerType),
		normalizeFactValue(data?.container_type),
		normalizeFactValue(data?.name)
	].filter((hint): hint is string => Boolean(hint))

	return [...tags, ...(description ? [description] : []), ...dataHints].some(
		hasWindowKeyword
	)
}

export const collectGroundedFacts = (
	name: InlineToolName,
	output: Record<string, unknown>,
	facts: GroundedTurnFacts
): number => {
	let added = 0

	switch (name) {
		case 'memory_read': {
			const entries = Array.isArray(output.entries) ? output.entries : []
			for (const entry of entries) {
				const record = isRecord(entry) ? entry : null
				if (!record) {
					continue
				}
				const position = tryParsePosition(record.position)
				if (position) {
					added += addPositionCapability(facts, position, 'navigate_to') ? 1 : 0
					added += addPositionCapability(facts, position, 'place_block') ? 1 : 0
					added +=
						isWindowCompatibleMemoryEntry(record) &&
						addPositionCapability(facts, position, 'open_window')
							? 1
							: 0
				}
			}
			return added
		}
		case 'inspect_blocks': {
			const blocks = Array.isArray(output.blocks) ? output.blocks : []
			for (const block of blocks) {
				const record = isRecord(block) ? block : null
				if (!record) {
					continue
				}
				const position = tryParsePosition(record.position)
				if (position) {
					added += addPositionCapability(facts, position, 'navigate_to') ? 1 : 0
					added += addPositionCapability(facts, position, 'break_block') ? 1 : 0
					added += addPositionCapability(facts, position, 'place_block') ? 1 : 0
					added +=
						normalizeFactValue(record.kind) === 'interactable' &&
						addPositionCapability(facts, position, 'open_window')
							? 1
							: 0
				}
			}
			return added
		}
		case 'inspect_entities': {
			const entities = Array.isArray(output.entities) ? output.entities : []
			for (const entity of entities) {
				const record = isRecord(entity) ? entity : null
				const label = normalizeFactValue(record?.label)
				if (label) {
					added += addGroundedReference(
						facts.entityNames,
						label,
						'inspect_entities'
					)
						? 1
						: 0
				}
				const type = normalizeFactValue(record?.type)
				if (type) {
					added += addGroundedReference(
						facts.entityTypes,
						type,
						'inspect_entities'
					)
						? 1
						: 0
				}
				if (label && type) {
					const pairKey = entityNameTypePairKey(label, type)
					if (!facts.entityNameTypePairs.has(pairKey)) {
						facts.entityNameTypePairs.add(pairKey)
						added += 1
					}
				}
			}
			return added
		}
		case 'inspect_window': {
			const window = isRecord(output.window) ? output.window : null
			const position = tryParsePosition(window?.position)
			if (position) {
				added += addPositionCapability(facts, position, 'navigate_to') ? 1 : 0
				added += addPositionCapability(facts, position, 'place_block') ? 1 : 0
				added += addPositionCapability(facts, position, 'open_window') ? 1 : 0
			}
			return added
		}
		default:
			return 0
	}
}
