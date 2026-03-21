import test from 'node:test'
import assert from 'node:assert/strict'

import { AntiLoopGuard } from '../../hsm/utils/antiLoop.js'

test('AntiLoopGuard ignores repeated updates with the same state signature', () => {
	const guard = new AntiLoopGuard({
		maxTransitionsPerSecond: 2,
		emergencyStopAfter: 100,
		windowMs: 1000
	})

	assert.equal(guard.recordUpdate('TASKS.THINKING'), true)
	assert.equal(guard.recordUpdate('TASKS.THINKING'), true)
	assert.equal(guard.recordUpdate('TASKS.THINKING'), true)

	const stats = guard.getStats()
	assert.equal(stats.loopDetected, false)
	assert.equal(stats.totalUpdates, 1)
	assert.equal(stats.updatesInLastSecond, 1)
})
