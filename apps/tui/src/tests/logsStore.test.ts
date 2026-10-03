import assert from 'node:assert/strict'
import test from 'node:test'
import { setImmediate as flush } from 'node:timers/promises'

import { createLogViewStore } from '../features/logs/store.js'
import { publicRuntime } from './fixtures/runtime.js'

test('log adapter caches no-ops and isolates duplicate, removed and throwing local memberships', async () => {
	const source = publicRuntime()
	source.append('first')
	const store = createLogViewStore(source.runtime.telemetry.getLogHistory())
	const initial = store.getSnapshot()
	store.receive(source.runtime.telemetry.getLogHistory())
	assert.equal(store.getSnapshot(), initial)
	store.subscribe(() => {
		throw new Error('local observer fixture')
	})
	store.subscribe(async () => {
		throw new Error('local async observer fixture')
	})
	let calls = 0
	const listener = () => {
		calls++
	}
	const a = store.subscribe(listener),
		b = store.subscribe(listener)
	store.toggleDebug()
	assert.equal(calls, 2)
	a()
	a()
	store.scroll(-1)
	assert.equal(calls, 3)
	b()
	source.append('later', 'debug')
	store.receive(source.runtime.telemetry.getLogHistory())
	assert.equal(store.getSnapshot().newCount, 1)
	assert.equal(calls, 3)
	let skipped = 0,
		disposeOther = () => {}
	store.subscribe(() => {
		disposeOther()
	})
	disposeOther = store.subscribe(() => {
		skipped++
	})
	store.goLive()
	assert.equal(skipped, 0)
	assert.equal(source.counts().logSubscriptions, 0)
	assert.equal(source.counts().snapshotSubscriptions, 0)
	await flush()
})
