import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { LogEntry, LogHistory, LogLevel } from '@voxel-pilot/contracts'

import { createLogView } from '../src/index.js'

function source(limit = 8) {
	let revision = 0
	let entries: readonly LogEntry[] = []
	const counts = { debug: 0, info: 0, warn: 0, error: 0 }
	let evicted = 0,
		truncated = 0
	const snapshot = (): LogHistory =>
		Object.freeze({
			id: 'opaque-journal',
			revision,
			level: 'debug',
			limits: Object.freeze({
				maxEntries: limit,
				maxBytes: 100000,
				maxEntryBytes: 1000
			}),
			entries,
			stats: Object.freeze({
				retainedEntries: entries.length,
				retainedBytes: entries.length * 100,
				acceptedEntries: revision,
				acceptedByLevel: Object.freeze({ ...counts }),
				evictedEntries: evicted,
				evictedBytes: evicted * 100,
				truncatedEntries: truncated
			})
		})
	return {
		snapshot,
		append(level: LogLevel = 'info', cut = false) {
			counts[level]++
			revision++
			if (cut) truncated++
			const entry: LogEntry = Object.freeze({
				id: `unparseable/${revision}#`,
				timestamp: revision,
				level,
				source: 'fixture',
				message: String(revision),
				truncation: cut ? Object.freeze({ originalMessageBytes: 2000 }) : null
			})
			const next = [...entries, entry]
			evicted += Math.max(0, next.length - limit)
			entries = Object.freeze(next.slice(-limit))
			return snapshot()
		}
	}
}
const ids = (entries: readonly LogEntry[]) => entries.map(entry => entry.id)

test('INFO+ defaults, retained DEBUG toggles without changing source or inventing arrivals', () => {
	const journal = source()
	journal.append('debug')
	const history = journal.append('info')
	const model = createLogView(history)
	assert(Object.isFrozen(model))
	assert.deepEqual(ids(model.getSnapshot().entries), [history.entries[1]!.id])
	assert.equal(model.getSnapshot().mode, 'live')
	assert.deepEqual(model.toggleDebug().entries, history.entries)
	assert.equal(model.getSnapshot().newCount, 0)
	assert.equal(model.toggleDebug().entries[0], history.entries[1])
	assert(Object.isFrozen(model.getSnapshot()))
	assert(Object.isFrozen(model.getSnapshot().entries))
})

test('PAUSED uses a source ID, scalar level counters and skipped authoritative revisions', () => {
	const journal = source()
	journal.append('debug')
	journal.append('info')
	const initial = journal.append('warn')
	const model = createLogView(initial)
	const pause = model.scroll(-1)
	assert.equal(pause.anchorId, initial.entries[1]!.id)
	assert.equal(pause.mode, 'paused')
	journal.append('debug')
	journal.append('error')
	const latest = journal.append('info')
	const next = model.receive(latest)
	assert.equal(next.anchorId, pause.anchorId)
	assert.deepEqual(ids(next.entries), ids(pause.entries))
	assert.equal(next.newCount, 2)
	assert.equal(model.toggleDebug().newCount, 3)
	assert.equal(model.toggleDebug().newCount, 2)
	assert.equal(model.receive(initial), model.getSnapshot())
	assert.equal(model.receive(latest), model.getSnapshot())
	assert.equal(model.goLive().newCount, 0)
	assert.equal(model.getSnapshot().entries.at(-1), latest.entries.at(-1))
})

test('hidden DEBUG anchor remains logical and restores, even with no preceding eligible row', () => {
	const journal = source()
	journal.append('debug')
	journal.append('debug')
	const history = journal.append('info')
	const model = createLogView(history)
	model.toggleDebug()
	const pause = model.scroll(-1)
	assert.equal(pause.anchorId, history.entries[1]!.id)
	const hidden = model.toggleDebug()
	assert.equal(hidden.mode, 'paused')
	assert.equal(hidden.anchorId, pause.anchorId)
	assert.equal(hidden.displayAnchorId, null)
	assert.deepEqual(hidden.entries, [])
	assert.equal(model.scroll(-1), hidden)
	assert.equal(model.toggleDebug().displayAnchorId, pause.anchorId)
	model.toggleDebug()
	assert.equal(model.scroll(1).mode, 'live')
})

test('hidden DEBUG anchor displays the nearest preceding matching source row', () => {
	const journal = source()
	journal.append('info')
	journal.append('debug')
	const history = journal.append('error')
	const model = createLogView(history)
	model.toggleDebug()
	model.scroll(-1)
	assert.equal(model.toggleDebug().displayAnchorId, history.entries[0]!.id)
	assert.equal(model.getSnapshot().anchorId, history.entries[1]!.id)
})

test('evicted anchor stays PAUSED at earliest matching row, exact counts survive eviction', () => {
	const journal = source(3)
	journal.append('info')
	journal.append('info')
	const history = journal.append('error')
	const model = createLogView(history)
	model.scroll(-2)
	journal.append('debug')
	journal.append('warn')
	journal.append('info', true)
	journal.append('debug')
	const latest = journal.append('error')
	const next = model.receive(latest)
	assert.equal(next.anchorLost, true)
	assert.equal(next.mode, 'paused')
	assert.equal(next.anchorId, latest.entries[0]!.id)
	assert.equal(next.newCount, 3)
	assert.equal(next.evictedEntries, 5)
	assert.equal(next.truncatedEntries, 1)
	assert.deepEqual(ids(next.entries), [latest.entries[0]!.id])
	assert.equal(model.toggleDebug().newCount, 5)
	const live = model.goLive()
	assert.equal(live.anchorLost, false)
	assert.equal(live.evictedEntries, 5)
	assert.equal(live.truncatedEntries, 1)
	assert.equal(live.newCount, 0)
})

test('empty/filter-only histories never resume PAUSED; navigation clamps and End resumes', () => {
	const journal = source(1)
	const model = createLogView(journal.snapshot())
	assert.equal(model.scroll(-1), model.getSnapshot())
	model.receive(journal.append())
	assert.equal(model.scroll(-1).mode, 'paused')
	const hidden = model.receive(journal.append('debug'))
	assert.equal(hidden.mode, 'paused')
	assert.equal(hidden.anchorLost, true)
	assert.deepEqual(hidden.entries, [])
	assert.equal(model.scroll(1), hidden)
	assert.equal(model.toggleDebug().mode, 'paused')
	assert.equal(model.scroll(-100).mode, 'paused')
	assert.equal(model.scroll(100).mode, 'live')
	assert.equal(model.goLive(), model.getSnapshot())
	assert.throws(() => model.scroll(NaN), RangeError)
	assert.throws(() => model.scroll(0.5), RangeError)
})

test('journal replacement resets pause but preserves filter; storage stays bounded under flood', () => {
	const journal = source(4)
	const model = createLogView(journal.append())
	model.toggleDebug()
	model.scroll(-1)
	for (let index = 0; index < 10000; index++) {
		const history = journal.append(index % 2 ? 'info' : 'debug')
		model.receive(history)
		assert(model.getSnapshot().entries.length <= 4)
		assert(
			model
				.getSnapshot()
				.entries.every(entry => history.entries.includes(entry))
		)
	}
	assert.equal(model.getSnapshot().newCount, 10000)
	const replacement = source().append('debug')
	const reset = model.receive(
		Object.freeze({ ...replacement, id: 'different opaque ID' })
	)
	assert.equal(reset.mode, 'live')
	assert.equal(reset.includeDebug, true)
	assert.equal(reset.newCount, 0)
	assert.equal(reset.anchorLost, false)
	assert.equal(reset.anchorId, null)
})
