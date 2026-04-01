import assert from 'node:assert/strict'
import test from 'node:test'

import { AgentLoopGuard } from '../../ai/AgentLoopGuard.js'

test('AgentLoopGuard aborts after three identical failures for same tool, args, and reason', () => {
	const guard = new AgentLoopGuard({
		maxRepeats: 3
	})

	const first = guard.recordFailure({
		toolName: 'break_block',
		args: { x: 10, y: 64, z: 10 },
		reason: 'Unreachable'
	})
	const second = guard.recordFailure({
		toolName: 'break_block',
		args: { z: 10, y: 64, x: 10 },
		reason: 'Unreachable'
	})
	const third = guard.recordFailure({
		toolName: 'break_block',
		args: { x: 10, y: 64, z: 10 },
		reason: 'Unreachable'
	})

	assert.equal(first.shouldAbort, false)
	assert.equal(second.shouldAbort, false)
	assert.equal(third.shouldAbort, true)
	assert.equal(third.repeats, 3)
})

test('AgentLoopGuard resets repeat tracking after success or changed failure signature', () => {
	const guard = new AgentLoopGuard({
		maxRepeats: 3
	})

	guard.recordFailure({
		toolName: 'navigate_to',
		args: { x: 1, y: 64, z: 1 },
		reason: 'Path blocked'
	})
	guard.recordSuccess()

	const afterSuccess = guard.recordFailure({
		toolName: 'navigate_to',
		args: { x: 1, y: 64, z: 1 },
		reason: 'Path blocked'
	})

	assert.equal(afterSuccess.repeats, 1)

	const changedReason = guard.recordFailure({
		toolName: 'navigate_to',
		args: { x: 1, y: 64, z: 1 },
		reason: 'Interrupted by combat'
	})

	assert.equal(changedReason.repeats, 1)
	assert.equal(changedReason.shouldAbort, false)
})
