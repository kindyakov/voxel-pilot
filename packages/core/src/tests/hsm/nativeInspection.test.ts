import assert from 'node:assert/strict'
import test from 'node:test'
import { setImmediate as flush } from 'node:timers/promises'

import { type InspectionEvent, createActor, setup } from 'xstate'

import type {
	NativeInspectionControls,
	NativeInspectionOptions,
	NativeInspectionRecord
} from '../../hsm/inspection/index.js'
import {
	captureInspectionOptions,
	createNativeInspectionSource
} from '../../hsm/inspection/source.js'
import { fixtureLogger } from './fixtures/services.js'

const deferred = () => {
	let resolve!: () => void
	let reject!: (error: Error) => void
	const promise = new Promise<void>((done, fail) => {
		resolve = done
		reject = fail
	})
	return { promise, resolve, reject }
}

function scheduler() {
	const tasks: { run: () => void; canceled: boolean }[] = []
	return {
		tasks,
		pending: () => tasks.filter(task => !task.canceled).length,
		schedule(run: () => void) {
			const task = { run, canceled: false }
			tasks.push(task)
			return () => {
				task.canceled = true
			}
		},
		run() {
			const task = tasks.shift()
			assert.ok(task)
			if (!task.canceled) task.run()
		}
	}
}

function nativeFact(t: test.TestContext): InspectionEvent {
	const facts: InspectionEvent[] = []
	const actor = createActor(
		setup({}).createMachine({ initial: 'idle', states: { idle: {} } }),
		{ inspect: event => facts.push(event) }
	)
	t.after(() => actor.stop())
	assert.equal(facts[0]?.type, '@xstate.actor')
	return facts[0]!
}

test('native ingress retains a finite ring, evicts oldest facts and yields in finite batches', t => {
	const clock = scheduler()
	const records: NativeInspectionRecord[] = []
	let controls!: NativeInspectionControls
	const source = createNativeInspectionSource(
		captureInspectionOptions({
			capacity: 3,
			batchSize: 2,
			createObserver(value) {
				controls = value
				return {
					next: record => {
						records.push(record)
					}
				}
			}
		})!,
		fixtureLogger,
		clock.schedule
	)
	t.after(() => source.dispose())
	const event = nativeFact(t)
	for (let i = 0; i < 10; i++) source.inspect(event)
	assert.equal(records.length, 0, 'native ingress does not run adapter work')
	assert.equal(clock.pending(), 1)
	assert.equal(controls.getStats().queued, 3)
	assert.equal(controls.getStats().dropped, 7)
	clock.run()
	assert.deepEqual(
		records.map(record => record.sequence),
		[8, 9]
	)
	assert.equal(clock.pending(), 1)
	assert.equal(controls.getStats().queued, 1)
	clock.run()
	assert.deepEqual(
		records.map(record => record.sequence),
		[8, 9, 10]
	)
	assert.equal(controls.getStats().delivered, 3)
	assert.equal(clock.pending(), 0)
	assert.ok(Object.isFrozen(records[0]))
	assert.equal(
		records[0]?.event,
		event,
		'native occurrence is not serialized or cloned'
	)
	assert.equal(Object.isFrozen(event.actorRef), false)
})

test('async observers have one in-flight callback while overflow remains bounded', async t => {
	const gate = deferred()
	const clock = scheduler()
	let controls!: NativeInspectionControls
	let calls = 0
	const source = createNativeInspectionSource(
		captureInspectionOptions({
			capacity: 2,
			createObserver(value) {
				controls = value
				return { next: () => (++calls === 1 ? gate.promise : undefined) }
			}
		})!,
		fixtureLogger,
		clock.schedule
	)
	t.after(() => source.dispose())
	const event = nativeFact(t)
	source.inspect(event)
	clock.run()
	for (let i = 0; i < 8; i++) source.inspect(event)
	assert.equal(calls, 1)
	assert.equal(controls.getStats().inFlight, true)
	assert.equal(controls.getStats().queued, 2)
	assert.equal(controls.getStats().dropped, 6)
	assert.equal(clock.pending(), 0)
	gate.resolve()
	await flush()
	assert.equal(clock.pending(), 1)
	clock.run()
	assert.equal(calls, 3)
	assert.equal(controls.getStats().inFlight, false)
})

test('detach cancels queued work and closes only the observer once; late rejection is inert', async t => {
	const gate = deferred()
	const clock = scheduler()
	let controls!: NativeInspectionControls
	let calls = 0,
		closes = 0
	const source = createNativeInspectionSource(
		captureInspectionOptions({
			createObserver(value) {
				controls = value
				return {
					next() {
						calls++
						return gate.promise
					},
					dispose() {
						closes++
					}
				}
			}
		})!,
		fixtureLogger,
		clock.schedule
	)
	const event = nativeFact(t)
	source.inspect(event)
	clock.run()
	source.inspect(event)
	controls.detach()
	controls.detach()
	source.dispose()
	assert.equal(closes, 1)
	assert.equal(controls.getStats().queued, 0)
	gate.reject(new Error('private late observer marker'))
	await flush()
	source.inspect(event)
	assert.equal(calls, 1)
	assert.equal(clock.pending(), 0)
	assert.equal(controls.getStats().failed, false)
})

for (const asynchronous of [false, true])
	test(`a ${asynchronous ? 'rejected' : 'throwing'} observer is detached with one safe report and cleanup`, async t => {
		const clock = scheduler()
		let controls!: NativeInspectionControls
		let closes = 0
		const warnings = t.mock.method(fixtureLogger, 'warn', () => {})
		const source = createNativeInspectionSource(
			captureInspectionOptions({
				createObserver(value) {
					controls = value
					return {
						next() {
							if (asynchronous)
								return Promise.reject(new Error('private observer payload'))
							throw new Error('private observer payload')
						},
						dispose() {
							closes++
							throw new Error('private cleanup payload')
						}
					}
				}
			})!,
			fixtureLogger,
			clock.schedule
		)
		const event = nativeFact(t)
		source.inspect(event)
		source.inspect(event)
		clock.run()
		await flush()
		source.inspect(event)
		source.dispose()
		assert.equal(controls.getStats().active, false)
		assert.equal(controls.getStats().failed, true)
		assert.equal(controls.getStats().queued, 0)
		assert.equal(clock.pending(), 0)
		assert.equal(closes, 1)
		assert.equal(warnings.mock.callCount(), 1)
		assert.doesNotMatch(JSON.stringify(warnings.mock.calls), /private|payload/)
	})

test('factory reentrant detach closes its returned observer and schedules nothing', t => {
	const clock = scheduler()
	let closes = 0
	const source = createNativeInspectionSource(
		captureInspectionOptions({
			createObserver(controls) {
				controls.detach()
				return {
					next() {},
					dispose: () => {
						closes++
					}
				}
			}
		})!,
		fixtureLogger,
		clock.schedule
	)
	source.inspect(nativeFact(t))
	source.dispose()
	assert.equal(closes, 1)
	assert.equal(clock.pending(), 0)
})

test('capture validates finite limits before factory creation and copies later mutable options', () => {
	let factories = 0
	const options: NativeInspectionOptions = {
		createObserver() {
			factories++
			return { next() {} }
		}
	}
	assert.equal(captureInspectionOptions(), undefined)
	for (const capacity of [0, -1, 1.5, NaN, Infinity, 65_537])
		assert.throws(
			() => captureInspectionOptions({ ...options, capacity }),
			/Inspection/
		)
	for (const batchSize of [0, -1, 1.5, NaN, Infinity, 4])
		assert.throws(
			() => captureInspectionOptions({ ...options, capacity: 3, batchSize }),
			/Inspection/
		)
	const captured = captureInspectionOptions(options)!
	Object.assign(options, {
		capacity: 1,
		createObserver() {
			throw new Error('mutated')
		}
	})
	assert.equal(captured.capacity, 1024)
	assert.equal(captured.batchSize, 64)
	assert.ok(Object.isFrozen(captured))
	assert.equal(factories, 0)
})
