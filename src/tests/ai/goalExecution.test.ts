import assert from 'node:assert/strict'
import test from 'node:test'

import {
	advanceGoalExecution,
	createGoalExecution,
	getGoalStopReason
} from '../../ai/goalExecution.js'

test('a goal stops after three consecutive failures even when their causes alternate', () => {
	let goal = createGoalExecution()
	for (const reason of ['Blocked', 'No item', 'Blocked']) {
		goal = advanceGoalExecution(goal, { type: 'started' })
		goal = advanceGoalExecution(goal, { type: 'failed', reason })
	}
	assert.match(getGoalStopReason(goal) ?? '', /Blocked/)
})

test('success resets failures but 128 started actions still exhaust the goal', () => {
	let goal = advanceGoalExecution(createGoalExecution(), {
		type: 'rejected',
		reason: 'Bad range'
	})
	for (let index = 0; index < 128; index++) {
		goal = advanceGoalExecution(goal, { type: 'started' })
		goal = advanceGoalExecution(goal, { type: 'succeeded' })
		assert.equal(goal.consecutiveFailures, 0)
		assert.equal(goal.lastFailure, null)
	}
	assert.match(getGoalStopReason(goal) ?? '', /лимит действий/)
})

test('rejection consumes failure budget, interruption preserves it, and a new goal resets it', () => {
	let goal = createGoalExecution()
	goal = advanceGoalExecution(goal, { type: 'rejected', reason: 'Bad range' })
	goal = advanceGoalExecution(goal, { type: 'started' })
	goal = advanceGoalExecution(goal, { type: 'interrupted' })
	assert.equal(getGoalStopReason(goal), null)
	assert.equal(goal.attempts, 1)
	assert.equal(goal.consecutiveFailures, 1)
	goal = advanceGoalExecution(goal, { type: 'failed', reason: 'Blocked' })
	goal = advanceGoalExecution(goal, { type: 'rejected', reason: 'Bad count' })
	assert.match(getGoalStopReason(goal) ?? '', /Bad count/)
	assert.equal(getGoalStopReason(createGoalExecution()), null)
})

test('transport failures preserve the validation failure budget', () => {
	let goal = createGoalExecution()
	goal = advanceGoalExecution(goal, { type: 'rejected', reason: 'Bad range' })
	goal = advanceGoalExecution(goal, {
		type: 'transport_failed',
		reason: 'Connection refused'
	})
	goal = advanceGoalExecution(goal, {
		type: 'transport_failed',
		reason: 'DNS unavailable'
	})

	assert.equal(goal.consecutiveFailures, 1)
	assert.equal(goal.lastFailure, 'Bad range')
	assert.equal(getGoalStopReason(goal), null)
})
