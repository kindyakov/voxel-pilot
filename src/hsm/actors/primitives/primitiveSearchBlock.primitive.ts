import {
	type BaseServiceState,
	createStatefulService
} from '@/hsm/helpers/createStatefulService'
import {
	type AnalyzedBlock,
	type YRangeFilter,
	analyzeBlock,
	filterByYRange,
	filterSafeBlocks,
	selectBestBlocks
} from '@/hsm/utils/blockAnalysis'
import type { Block } from '@/types'

interface SearchBlockState extends BaseServiceState {
	blockName: string
	maxDistance: number
	count: number
	mode: 'simple' | 'mining'
	blockId: number | null
	searching: boolean
	yRange?: YRangeFilter
	prioritizeSafety: boolean
}

export interface SearchBlockOptions {
	blockName: string
	maxDistance?: number
	count?: number
	mode?: 'simple' | 'mining'
	maxYDiffAbove?: number
	maxYDiffBelow?: number
	prioritizeSafety?: boolean
}

const DEFAULT_MAX_DISTANCE = 32
const DEFAULT_COUNT = 1
const DEFAULT_MODE = 'simple'
const DEFAULT_MINING_MAX_Y_DIFF_ABOVE = 6
const DEFAULT_MINING_MAX_Y_DIFF_BELOW = 2
const SEARCH_TICK_INTERVAL_MS = 50

const emitNotFound = (
	sendBack: (event: { type: 'NOT_FOUND'; reason: string }) => void,
	setState: (updates: Partial<SearchBlockState>) => void,
	reason: string
) => {
	setState({ searching: false })
	sendBack({
		type: 'NOT_FOUND',
		reason
	})
}

const emitFound = (
	sendBack: (event: { type: 'BLOCKS_FOUND'; blocks: Block[] }) => void,
	setState: (updates: Partial<SearchBlockState>) => void,
	blocks: Block[]
) => {
	setState({ searching: false })
	sendBack({
		type: 'BLOCKS_FOUND',
		blocks
	})
}

const getNearestBlock = (blocks: AnalyzedBlock[]): AnalyzedBlock | null =>
	[...blocks].sort((a, b) => a.distanceTotal - b.distanceTotal)[0] ?? null

export const primitiveSearchBlock = createStatefulService<
	SearchBlockState,
	SearchBlockOptions
>({
	name: 'primitiveSearchBlock',
	tickInterval: SEARCH_TICK_INTERVAL_MS,
	initialState: {
		blockName: '',
		maxDistance: DEFAULT_MAX_DISTANCE,
		count: DEFAULT_COUNT,
		mode: DEFAULT_MODE,
		blockId: null,
		searching: false,
		prioritizeSafety: false
	},

	onStart: ({ input, bot, setState, sendBack }) => {
		const {
			blockName,
			maxDistance = DEFAULT_MAX_DISTANCE,
			count = DEFAULT_COUNT,
			mode = DEFAULT_MODE,
			maxYDiffAbove,
			maxYDiffBelow,
			prioritizeSafety = false
		} = input

		if (!blockName) {
			emitNotFound(sendBack, setState, 'Missing required parameter: blockName')
			return
		}

		const blockData = bot.registry.blocksByName[blockName]
		if (!blockData) {
			emitNotFound(sendBack, setState, `Unknown block type: ${blockName}`)
			return
		}

		setState({
			blockName,
			maxDistance,
			count,
			mode,
			blockId: blockData.id,
			searching: true,
			yRange:
				mode === 'mining'
					? {
							above: maxYDiffAbove ?? DEFAULT_MINING_MAX_Y_DIFF_ABOVE,
							below: maxYDiffBelow ?? DEFAULT_MINING_MAX_Y_DIFF_BELOW
						}
					: undefined,
			prioritizeSafety
		})
	},

	onTick: ({ state, bot, setState, sendBack }) => {
		const {
			blockName,
			maxDistance,
			count,
			mode,
			blockId,
			searching,
			yRange,
			prioritizeSafety
		} = state

		if (!searching || blockId === null) {
			return
		}

		const positions = bot.findBlocks({
			matching: blockId,
			maxDistance,
			count: Math.max(count * 10, 100)
		})

		const analyzedBlocks = positions
			.map(position => analyzeBlock(position, bot))
			.filter((block): block is AnalyzedBlock => block !== null)

		if (analyzedBlocks.length === 0) {
			emitNotFound(
				sendBack,
				setState,
				`No ${blockName} found within ${maxDistance}m`
			)
			return
		}

		if (mode === 'simple') {
			const nearestBlock = getNearestBlock(analyzedBlocks)
			if (!nearestBlock) {
				emitNotFound(sendBack, setState, `No ${blockName} blocks found`)
				return
			}

			emitFound(sendBack, setState, [nearestBlock.block])
			return
		}

		let candidates = yRange
			? filterByYRange(analyzedBlocks, bot.entity.position.y, yRange)
			: analyzedBlocks

		if (prioritizeSafety) {
			candidates = filterSafeBlocks(candidates, bot)
		}

		if (candidates.length === 0) {
			emitNotFound(
				sendBack,
				setState,
				`No ${blockName} blocks found after filtering`
			)
			return
		}

		emitFound(
			sendBack,
			setState,
			selectBestBlocks(candidates, count).map(block => block.block)
		)
	}
})
