import { readFile } from 'node:fs/promises'

import { parse, simplify } from 'prismarine-nbt'

export interface SchematicPaletteEntry {
	state: string
	paletteIndex: number
	count: number
}

export interface SchematicSampleBlock {
	x: number
	y: number
	z: number
	paletteIndex: number
	state: string
}

export interface SchematicSummary {
	filePath?: string
	version: number | null
	dataVersion: number | null
	dimensions: {
		width: number
		height: number
		length: number
	}
	offset: [number, number, number] | null
	paletteSize: number
	totalBlocks: number
	filledBlocks: number
	blockEntitiesCount: number
	topPaletteEntries: SchematicPaletteEntry[]
	sampleBlocks: SchematicSampleBlock[]
}

interface SimplifiedSpongeSchematic {
	Version?: unknown
	DataVersion?: unknown
	PaletteMax?: unknown
	Width?: unknown
	Height?: unknown
	Length?: unknown
	Offset?: unknown
	Palette?: unknown
	BlockData?: unknown
	BlockEntities?: unknown
}

const DEFAULT_TOP_PALETTE_LIMIT = 10
const DEFAULT_SAMPLE_BLOCK_LIMIT = 10

const toNumber = (value: unknown): number | null => {
	if (typeof value !== 'number' || !Number.isFinite(value)) {
		return null
	}

	return value
}

const toNumberArray = (value: unknown): number[] | null => {
	if (!Array.isArray(value)) {
		return null
	}

	const parsed = value.map(item => toNumber(item))
	return parsed.every(item => item !== null) ? (parsed as number[]) : null
}

const toRecord = (value: unknown): Record<string, unknown> | null => {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return null
	}

	return value as Record<string, unknown>
}

const normalizeFilePath = (filePath: string): string =>
	filePath.replace(/\\/g, '/')

const createPaletteIndexMap = (
	palette: Record<string, unknown>
): Map<number, string> => {
	const indexToState = new Map<number, string>()

	for (const [state, rawIndex] of Object.entries(palette)) {
		const paletteIndex = toNumber(rawIndex)
		if (paletteIndex === null) {
			continue
		}

		indexToState.set(paletteIndex, state)
	}

	return indexToState
}

export const decodePaletteIndices = (
	blockData: number[] | Uint8Array
): number[] => {
	const bytes = Array.from(blockData)
	const indices: number[] = []
	let currentValue = 0
	let shift = 0

	for (const byte of bytes) {
		currentValue |= (byte & 0x7f) << shift

		if ((byte & 0x80) === 0) {
			indices.push(currentValue >>> 0)
			currentValue = 0
			shift = 0
			continue
		}

		shift += 7

		if (shift > 35) {
			throw new Error('Invalid Sponge schematic BlockData: varint is too long')
		}
	}

	if (shift !== 0) {
		throw new Error('Invalid Sponge schematic BlockData: truncated varint')
	}

	return indices
}

export const summarizeSimplifiedSchematic = (
	schematic: SimplifiedSpongeSchematic,
	options?: {
		topPaletteLimit?: number
		sampleBlockLimit?: number
	}
): SchematicSummary => {
	const width = toNumber(schematic.Width)
	const height = toNumber(schematic.Height)
	const length = toNumber(schematic.Length)

	if (width === null || height === null || length === null) {
		throw new Error('Invalid schematic: Width, Height, and Length must be numbers')
	}

	const paletteRecord = toRecord(schematic.Palette)
	if (!paletteRecord) {
		throw new Error('Invalid schematic: Palette is missing or malformed')
	}

	const blockData = toNumberArray(schematic.BlockData)
	if (!blockData) {
		throw new Error('Invalid schematic: BlockData is missing or malformed')
	}

	const indices = decodePaletteIndices(blockData)
	const totalBlocks = width * height * length

	if (indices.length !== totalBlocks) {
		throw new Error(
			`Invalid schematic: decoded ${indices.length} blocks, expected ${totalBlocks}`
		)
	}

	const indexToState = createPaletteIndexMap(paletteRecord)
	const counts = new Map<number, number>()
	const sampleBlocks: SchematicSampleBlock[] = []
	const fallbackSampleBlocks: SchematicSampleBlock[] = []
	const sampleBlockLimit =
		options?.sampleBlockLimit ?? DEFAULT_SAMPLE_BLOCK_LIMIT

	for (let index = 0; index < indices.length; index += 1) {
		const paletteIndex = indices[index]!
		counts.set(paletteIndex, (counts.get(paletteIndex) ?? 0) + 1)
		const x = index % width
		const z = Math.floor(index / width) % length
		const y = Math.floor(index / (width * length))
		const block = {
			x,
			y,
			z,
			paletteIndex,
			state: indexToState.get(paletteIndex) ?? `<palette:${paletteIndex}>`
		}

		if (fallbackSampleBlocks.length < sampleBlockLimit) {
			fallbackSampleBlocks.push(block)
		}

		if (
			block.state !== 'minecraft:air' &&
			sampleBlocks.length < sampleBlockLimit
		) {
			sampleBlocks.push(block)
		}
	}

	const topPaletteEntries = [...counts.entries()]
		.map(([paletteIndex, count]) => ({
			state: indexToState.get(paletteIndex) ?? `<palette:${paletteIndex}>`,
			paletteIndex,
			count
		}))
		.sort((left, right) => {
			if (right.count !== left.count) {
				return right.count - left.count
			}

			return left.paletteIndex - right.paletteIndex
		})
		.filter(entry => entry.state !== 'minecraft:air')
		.slice(0, options?.topPaletteLimit ?? DEFAULT_TOP_PALETTE_LIMIT)

	const offset = toNumberArray(schematic.Offset)
	const blockEntities = Array.isArray(schematic.BlockEntities)
		? schematic.BlockEntities
		: []
	const filledBlocks = [...counts.entries()].reduce((sum, [paletteIndex, count]) => {
		const state = indexToState.get(paletteIndex) ?? `<palette:${paletteIndex}>`
		return state === 'minecraft:air' ? sum : sum + count
	}, 0)

	return {
		version: toNumber(schematic.Version),
		dataVersion: toNumber(schematic.DataVersion),
		dimensions: {
			width,
			height,
			length
		},
		offset:
			offset && offset.length >= 3
				? [offset[0]!, offset[1]!, offset[2]!]
				: null,
		paletteSize: indexToState.size,
		totalBlocks,
		filledBlocks,
		blockEntitiesCount: blockEntities.length,
		topPaletteEntries,
		sampleBlocks: sampleBlocks.length > 0 ? sampleBlocks : fallbackSampleBlocks
	}
}

export const inspectSchematicFile = async (
	filePath: string
): Promise<SchematicSummary> => {
	const buffer = await readFile(filePath)
	const parsed = await parse(buffer)
	const simplified = simplify(parsed.parsed) as SimplifiedSpongeSchematic
	return {
		filePath: normalizeFilePath(filePath),
		...summarizeSimplifiedSchematic(simplified)
	}
}

export const formatSchematicSummary = (
	summary: SchematicSummary
): string => {
	const lines = [
		`File: ${summary.filePath ?? '<buffer>'}`,
		`Version: ${summary.version ?? 'unknown'} | DataVersion: ${summary.dataVersion ?? 'unknown'}`,
		`Dimensions: ${summary.dimensions.width} x ${summary.dimensions.height} x ${summary.dimensions.length}`,
		`Offset: ${
			summary.offset ? summary.offset.join(', ') : 'not provided'
		}`,
		`Palette size: ${summary.paletteSize}`,
		`Total blocks: ${summary.totalBlocks}`,
		`Filled blocks: ${summary.filledBlocks}`,
		`Block entities: ${summary.blockEntitiesCount}`,
		'',
		'Top palette entries:'
	]

	for (const entry of summary.topPaletteEntries) {
		lines.push(`- [${entry.paletteIndex}] ${entry.state} x${entry.count}`)
	}

	if (summary.topPaletteEntries.length === 0) {
		lines.push('- none')
	}

	lines.push('', 'Sample blocks:')

	for (const block of summary.sampleBlocks) {
		lines.push(
			`- (${block.x}, ${block.y}, ${block.z}) [${block.paletteIndex}] ${block.state}`
		)
	}

	if (summary.sampleBlocks.length === 0) {
		lines.push('- none')
	}

	return lines.join('\n')
}
