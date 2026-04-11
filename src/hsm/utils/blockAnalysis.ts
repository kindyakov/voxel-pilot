import { Vec3 as Vec3Class } from 'vec3'

import type { Block, Bot, Vec3 } from '@/types'

export interface AnalyzedBlock {
	block: Block
	position: Vec3
	distanceHorizontal: number
	distanceTotal: number
	yDiff: number
}

export interface YRangeFilter {
	above: number
	below: number
}

export interface ScoringOptions {
	yWeight?: number
	distanceWeight?: number
}

const DEFAULT_Y_WEIGHT = 10
const DEFAULT_DISTANCE_WEIGHT = 1
const UNSUPPORTED_BLOCK_NAMES = new Set(['air', 'cave_air'])

export function filterByYRange(
	blocks: AnalyzedBlock[],
	botY: number,
	yRange?: YRangeFilter
): AnalyzedBlock[] {
	if (!yRange) {
		return blocks.slice()
	}

	const minY = botY - yRange.below
	const maxY = botY + yRange.above

	return blocks.filter(block => {
		const blockY = block.position.y
		return blockY >= minY && blockY <= maxY
	})
}

export function isBlockDirectlyBelowBot(bot: Bot, pos: Vec3): boolean {
	const botPosition = bot.entity.position

	return (
		Math.floor(pos.x) === Math.floor(botPosition.x) &&
		Math.floor(pos.z) === Math.floor(botPosition.z) &&
		Math.floor(pos.y) === Math.floor(botPosition.y) - 1
	)
}

export function checkBlockSafety(
	bot: Bot,
	pos: Vec3
): { isSafe: boolean; reason?: string } {
	if (isBlockDirectlyBelowBot(bot, pos)) {
		return {
			isSafe: false,
			reason: 'Block is directly below the bot'
		}
	}

	const supportPos = new Vec3Class(pos.x, pos.y - 1, pos.z)
	const supportBlock = bot.blockAt(supportPos)
	const supportName =
		typeof supportBlock?.name === 'string'
			? supportBlock.name.toLowerCase()
			: ''

	if (!supportBlock || UNSUPPORTED_BLOCK_NAMES.has(supportName)) {
		return {
			isSafe: false,
			reason: 'Block has no support below'
		}
	}

	return {
		isSafe: true
	}
}

export function filterSafeBlocks(
	blocks: AnalyzedBlock[],
	bot: Bot
): AnalyzedBlock[] {
	return blocks.filter(block => checkBlockSafety(bot, block.position).isSafe)
}

export function calculateBlockScore(
	block: AnalyzedBlock,
	options: ScoringOptions = {}
): number {
	const yWeight = options.yWeight ?? DEFAULT_Y_WEIGHT
	const distanceWeight = options.distanceWeight ?? DEFAULT_DISTANCE_WEIGHT
	const yPenalty = Math.abs(block.yDiff) * yWeight
	const aboveBonus = block.yDiff > 0 ? yWeight / 2 : 0
	const distancePenalty = block.distanceTotal * distanceWeight

	return aboveBonus - yPenalty - distancePenalty
}

export function sortBlocksByPriority(blocks: AnalyzedBlock[]): AnalyzedBlock[] {
	return [...blocks].sort((a, b) => {
		const scoreDelta = calculateBlockScore(b) - calculateBlockScore(a)
		if (scoreDelta !== 0) {
			return scoreDelta
		}

		if (a.distanceTotal !== b.distanceTotal) {
			return a.distanceTotal - b.distanceTotal
		}

		if (a.distanceHorizontal !== b.distanceHorizontal) {
			return a.distanceHorizontal - b.distanceHorizontal
		}

		return Math.abs(a.yDiff) - Math.abs(b.yDiff)
	})
}

export function selectBestBlocks(
	blocks: AnalyzedBlock[],
	count: number
): AnalyzedBlock[] {
	if (count <= 0) {
		return []
	}

	return sortBlocksByPriority(blocks).slice(0, count)
}

export function analyzeBlock(pos: Vec3, bot: Bot): AnalyzedBlock | null {
	const block = bot.blockAt(pos)

	if (!block) {
		return null
	}

	const botPosition = bot.entity.position
	const dx = pos.x - botPosition.x
	const dz = pos.z - botPosition.z

	return {
		block,
		position: pos,
		distanceHorizontal: Math.sqrt(dx * dx + dz * dz),
		distanceTotal: botPosition.distanceTo(pos),
		yDiff: pos.y - botPosition.y
	}
}
