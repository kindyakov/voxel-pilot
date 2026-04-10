import assert from 'node:assert/strict'
import test from 'node:test'
import { Vec3 } from 'vec3'

import {
	calculateBlockScore,
	checkBlockSafety,
	filterByYRange,
	filterSafeBlocks,
	selectBestBlocks,
	sortBlocksByPriority,
	analyzeBlock
} from '../../hsm/utils/blockAnalysis.js'

import type { AnalyzedBlock } from '../../hsm/utils/blockAnalysis.js'

const createBlock = (y: number, yDiff: number, distance = 5): AnalyzedBlock => ({
	block: {
		name: 'stone',
		position: new Vec3(0, y, 0)
	} as any,
	position: new Vec3(0, y, 0),
	distanceHorizontal: distance,
	distanceTotal: distance,
	yDiff
})

const createBot = ({
	position = new Vec3(0, 64, 0),
	blockAt
}: {
	position?: Vec3
	blockAt?: (pos: Vec3) => any
} = {}) =>
	({
		entity: {
			position
		},
		blockAt:
			blockAt ??
			(() => ({
				name: 'stone'
			}))
	} as any)

test('filterByYRange keeps blocks within an asymmetric Y range', () => {
	const blocks = [
		createBlock(62, 999),
		createBlock(63, 999),
		createBlock(64, -999),
		createBlock(65, 999),
		createBlock(66, -999),
		createBlock(67, 999)
	]

	const filtered = filterByYRange(blocks, 64, { above: 2, below: 1 })

	assert.deepEqual(filtered.map(block => block.position.y), [63, 64, 65, 66])
	assert.deepEqual(blocks.map(block => block.position.y), [62, 63, 64, 65, 66, 67])
})

test('filterByYRange returns all blocks when no Y filter is specified', () => {
	const blocks = [createBlock(61, 0), createBlock(64, 0), createBlock(70, 0)]

	const filtered = filterByYRange(blocks, 64)

	assert.strictEqual(filtered.length, blocks.length)
	assert.deepEqual(filtered, blocks)
})

test('calculateBlockScore prefers level, above, and nearer blocks', () => {
	const level = createBlock(64, 0, 2)
	const above = createBlock(68, 4, 2)
	const below = createBlock(60, -4, 2)
	const near = createBlock(64, 0, 1)
	const far = createBlock(64, 0, 8)

	assert.ok(calculateBlockScore(level) > calculateBlockScore(above))
	assert.ok(calculateBlockScore(above) > calculateBlockScore(below))
	assert.ok(calculateBlockScore(near) > calculateBlockScore(far))
})

test('sortBlocksByPriority sorts by descending score without mutating the input array', () => {
	const blocks = [createBlock(60, -4, 8), createBlock(64, 0, 8), createBlock(68, 4, 1)]
	const original = [...blocks]

	const sorted = sortBlocksByPriority(blocks)

	assert.notStrictEqual(sorted, blocks)
	assert.deepEqual(blocks, original)
	assert.deepEqual(sorted, [blocks[1], blocks[2], blocks[0]])
})

test('selectBestBlocks returns the top N prioritized blocks', () => {
	const blocks = [
		createBlock(60, -4, 8),
		createBlock(64, 0, 8),
		createBlock(68, 4, 1)
	]

	const selected = selectBestBlocks(blocks, 2)

	assert.deepEqual(selected, [blocks[1], blocks[2]])
})

test('checkBlockSafety rejects a block directly below the bot and blocks without support below', () => {
	const bot = createBot({
		position: new Vec3(10.5, 64, 10.5),
		blockAt: pos => {
			if (pos.x === 11 && pos.y === 63 && pos.z === 10) {
				return null
			}

			return { name: 'stone' }
		}
	})

	const directlyBelow = new Vec3(10, 63, 10)
	const unsupported = new Vec3(11, 64, 10)
	const safe = createBlock(64, 0)
	const unsafe = createBlock(63, -1)
	unsafe.position = directlyBelow
	unsafe.block = {
		name: 'stone',
		position: directlyBelow
	} as any

	assert.equal(checkBlockSafety(bot, directlyBelow).isSafe, false)
	assert.equal(checkBlockSafety(bot, unsupported).isSafe, false)
	assert.deepEqual(filterSafeBlocks([unsafe, safe], bot), [safe])
})

test('analyzeBlock returns metrics for a real block and null when none exists', () => {
	const bot = createBot({
		position: new Vec3(2, 65, 2),
		blockAt: pos =>
			pos.x === 4 && pos.y === 66 && pos.z === 6
				? ({
						name: 'stone',
						position: pos
					} as any)
				: null
	})

	const pos = new Vec3(4, 66, 6)
	const analyzed = analyzeBlock(pos, bot)

	assert.ok(analyzed)
	assert.equal(analyzed?.position, pos)
	assert.equal(analyzed?.yDiff, 1)
	assert.equal(analyzed?.distanceHorizontal, Math.sqrt(20))
	assert.equal(analyzed?.distanceTotal, bot.entity.position.distanceTo(pos))
	assert.equal(analyzeBlock(new Vec3(1, 1, 1), createBot({ blockAt: () => null })), null)
})
