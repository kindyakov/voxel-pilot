import assert from 'node:assert/strict'
import test from 'node:test'

import type { Block } from '@/types/index.js'
import { Vec3 } from 'vec3'

import {
	advanceToNextBlock,
	createMiningTask,
	currentTarget,
	getMiningTask,
	isMiningTask,
	miningTaskFromRecord,
	positionKey,
	recordBreakFailure,
	recordNavigationFailure,
	sampleMiningInventory,
	storeFoundBlocks
} from '@/hsm/tasks/task.js'

import { BlockFactory, registry } from './fixtures/handoffBot.js'

const blockAt = (x: number, y: number, z: number, name = 'iron_ore'): Block => {
	const definition = registry.blocksByName[name]
	assert.ok(definition, `missing block fixture: ${name}`)
	const block: Block = BlockFactory.fromStateId(definition.minStateId, 0)
	block.position = new Vec3(x, y, z)
	return block
}

test('positionKey floors fractional player-adjacent coordinates', () => {
	assert.equal(positionKey({ x: 10.7, y: 64, z: -3.2 }), '10:64:-4')
})

test('createMiningTask starts a clean per-block budget', () => {
	const task = createMiningTask('iron_ore', 3)

	assert.equal(task.kind, 'mining')
	assert.equal(task.blockName, 'iron_ore')
	assert.equal(task.count, 3)
	assert.deepEqual(task.targetBlocks, [])
	assert.equal(task.collected, 0)
	assert.equal(task.navigationAttempts, 0)
	assert.equal(task.breakAttempts, 0)
	assert.equal(task.totalSearches, 0)
	assert.deepEqual(task.blacklist, [])
	assert.equal(task.lastFailure, null)
})

test('getMiningTask validates instead of blind-casting', () => {
	assert.equal(getMiningTask(null), null)
	assert.equal(getMiningTask({}), null)
	assert.equal(getMiningTask({ kind: 'farming' }), null)
	assert.equal(
		getMiningTask({ kind: 'mining', blockName: 'stone', count: 1 }),
		null
	)
	assert.equal(
		getMiningTask({ ...createMiningTask('stone', 1), taskId: 42 }),
		null
	)

	const task = createMiningTask('stone', 1)
	assert.equal(task.taskId, null)
	assert.equal(getMiningTask(task), task)
	assert.equal(isMiningTask(task), true)
	assert.equal(isMiningTask(null), false)
	assert.equal(createMiningTask('stone', 1, 'record-1').taskId, 'record-1')
})

test('miningTaskFromRecord lifts a suspended record with kept progress', () => {
	const task = miningTaskFromRecord({
		id: 'record-7',
		blockName: 'iron_ore',
		total: 5,
		done: 3
	})

	assert.equal(task.taskId, 'record-7')
	assert.equal(task.blockName, 'iron_ore')
	assert.equal(task.count, 5)
	assert.equal(task.collected, 3)
	assert.deepEqual(task.targetBlocks, [])
	assert.deepEqual(task.blacklist, [])
	assert.equal(getMiningTask(task), task)
})

test('storeFoundBlocks drops blacklisted positions and counts the round', () => {
	const failed = createMiningTask('iron_ore', 2)
	const bad = blockAt(10, 64, 0)
	const good = blockAt(11, 64, 0)
	const withFailure = recordBreakFailure(
		{ ...failed, targetBlocks: [bad, good], targetIndex: 0 },
		'no harvest tool'
	)

	const stored = storeFoundBlocks(withFailure, [bad, good])

	assert.deepEqual(
		stored.targetBlocks.map(block => block.position.x),
		[11]
	)
	assert.equal(stored.targetIndex, 0)
	assert.equal(stored.totalSearches, 1)
	// Attempts are preserved: the retry budget belongs to the new target.
	assert.equal(stored.breakAttempts, 1)
	assert.equal(currentTarget(stored), good)
})

test('inventory progress is independent of per-block failure bookkeeping', () => {
	const task = {
		...createMiningTask('iron_ore', 2),
		navigationAttempts: 1,
		breakAttempts: 1,
		lastFailure: 'stale'
	}

	const next = sampleMiningInventory(sampleMiningInventory(task, 5), 6)

	assert.equal(next.collected, 1)
	assert.equal(next.navigationAttempts, 1)
	assert.equal(next.breakAttempts, 1)
	assert.equal(next.lastFailure, 'stale')
})

test('advanceToNextBlock moves on with a fresh per-block budget', () => {
	const task = {
		...createMiningTask('iron_ore', 2),
		targetBlocks: [blockAt(1, 64, 0), blockAt(2, 64, 0)],
		navigationAttempts: 1,
		breakAttempts: 1
	}

	const next = advanceToNextBlock(task)

	assert.equal(next.targetIndex, 1)
	assert.equal(next.navigationAttempts, 0)
	assert.equal(next.breakAttempts, 0)
	assert.equal(next.collected, 0)
})

test('failures blacklist the current position once and keep the reason', () => {
	const bad = blockAt(10, 64, 0)
	const task = { ...createMiningTask('iron_ore', 2), targetBlocks: [bad] }

	const first = recordNavigationFailure(task, 'noPath')
	assert.equal(first.navigationAttempts, 1)
	assert.deepEqual(first.blacklist, ['10:64:0'])
	assert.equal(first.lastFailure, 'noPath')

	const second = recordNavigationFailure(first, 'timeout')
	assert.equal(second.navigationAttempts, 2)
	assert.deepEqual(second.blacklist, ['10:64:0'])
	assert.equal(second.lastFailure, 'timeout')

	const broken = recordBreakFailure(task, null)
	assert.equal(broken.breakAttempts, 1)
	assert.deepEqual(broken.blacklist, ['10:64:0'])
	assert.equal(broken.lastFailure, null)
})
