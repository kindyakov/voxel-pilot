import assert from 'node:assert/strict'
import test from 'node:test'
import { setImmediate as flush } from 'node:timers/promises'

import { createTelemetryStore } from '../runtime/telemetryStore.js'
import { publicRuntime } from './fixtures/runtime.js'

test('bridge retains cached public references, isolates observers and independently disposes duplicate tokens', async () => {
	const source = publicRuntime()
	source.append('before subscription')
	const store = createTelemetryStore(source.runtime.telemetry)
	const first = store.getSnapshot()
	assert.equal(first, store.getSnapshot())
	assert.equal(first.snapshot, source.runtime.telemetry.getSnapshot())
	assert.equal(first.history, source.runtime.telemetry.getLogHistory())
	store.subscribe(() => {
		throw new Error('observer fixture')
	})
	store.subscribe(async () => {
		throw new Error('async observer fixture')
	})
	let calls = 0
	const listener = () => {
		calls++
	}
	const a = store.subscribe(listener),
		b = store.subscribe(listener)
	source.append('DEBUG from source', 'debug')
	assert.equal(calls, 2)
	assert.equal(store.getSnapshot().snapshot, first.snapshot)
	assert.equal(
		store.getSnapshot().history,
		source.runtime.telemetry.getLogHistory()
	)
	a()
	a()
	source.connection('ready')
	assert.equal(calls, 3)
	b()
	const current = store.getSnapshot()
	store.dispose()
	store.dispose()
	source.connection('stopped')
	source.append('late')
	assert.equal(store.getSnapshot(), current)
	assert.equal(calls, 3)
	assert.equal(source.counts().activeSnapshots + source.counts().activeLogs, 0)
	await flush()
})

test('bridge unsubscribe during notification prevents later observer delivery', () => {
	const source = publicRuntime(),
		store = createTelemetryStore(source.runtime.telemetry)
	let skipped = 0,
		disposeOther = () => {}
	store.subscribe(() => {
		disposeOther()
	})
	disposeOther = store.subscribe(() => {
		skipped++
	})
	source.append('changed')
	assert.equal(skipped, 0)
	store.dispose()
})
