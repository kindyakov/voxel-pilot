import type { LogEntry, LogHistory, LogLevel } from '@voxel-pilot/contracts'

/** One current bounded source projection; terminal geometry belongs to the adapter. */
export interface LogViewSnapshot {
	readonly journalId: string
	readonly revision: number
	readonly collectionLevel: LogLevel
	readonly includeDebug: boolean
	readonly mode: 'live' | 'paused'
	/** Logical opaque source ID, including a temporarily hidden DEBUG record. */
	readonly anchorId: string | null
	/** Last eligible record at or before the logical anchor. */
	readonly displayAnchorId: string | null
	readonly entries: readonly LogEntry[]
	readonly newCount: number
	readonly evictedEntries: number
	readonly truncatedEntries: number
	readonly anchorLost: boolean
}

export interface LogView {
	getSnapshot(): LogViewSnapshot
	receive(history: LogHistory): LogViewSnapshot
	toggleDebug(): LogViewSnapshot
	/** Signed eligible-record movement. Reaching the latest row explicitly resumes LIVE. */
	scroll(offset: number): LogViewSnapshot
	goLive(): LogViewSnapshot
}

export function createLogView(initial: LogHistory): LogView {
	let history = initial
	let includeDebug = false
	let mode: LogViewSnapshot['mode'] = 'live'
	let anchorId: string | null = null
	let baseline: Readonly<Record<LogLevel, number>> | null = null
	let anchorLost = false
	const eligible = (entry: LogEntry) => includeDebug || entry.level !== 'debug'
	const rebuild = (): LogViewSnapshot => {
		const anchorIndex =
			mode === 'live'
				? history.entries.length - 1
				: history.entries.findIndex(entry => entry.id === anchorId)
		const entries = Object.freeze(
			history.entries.filter(
				(entry, index) => index <= anchorIndex && eligible(entry)
			)
		)
		const counts = history.stats.acceptedByLevel
		const delta = (level: LogLevel) =>
			baseline ? Math.max(0, counts[level] - baseline[level]) : 0
		return Object.freeze({
			journalId: history.id,
			revision: history.revision,
			collectionLevel: history.level,
			includeDebug,
			mode,
			anchorId,
			displayAnchorId: entries.at(-1)?.id ?? null,
			entries,
			newCount:
				delta('info') +
				delta('warn') +
				delta('error') +
				(includeDebug ? delta('debug') : 0),
			evictedEntries: history.stats.evictedEntries,
			truncatedEntries: history.stats.truncatedEntries,
			anchorLost
		})
	}
	let snapshot = rebuild()
	const publish = () => (snapshot = rebuild())
	const goLive = () => {
		if (mode === 'live') return snapshot
		mode = 'live'
		anchorId = null
		baseline = null
		anchorLost = false
		return publish()
	}
	return Object.freeze({
		getSnapshot: () => snapshot,
		receive(next: LogHistory) {
			if (next.id === history.id && next.revision <= history.revision)
				return snapshot
			if (next.id !== history.id) {
				mode = 'live'
				anchorId = null
				baseline = null
				anchorLost = false
			}
			history = next
			if (
				mode === 'paused' &&
				!history.entries.some(entry => entry.id === anchorId)
			) {
				anchorLost = true
				anchorId =
					history.entries.find(eligible)?.id ?? history.entries[0]?.id ?? null
			}
			return publish()
		},
		toggleDebug() {
			includeDebug = !includeDebug
			return publish()
		},
		scroll(offset: number) {
			if (!Number.isSafeInteger(offset))
				throw new RangeError('Log scroll requires a safe integer')
			if (!offset || (mode === 'live' && offset > 0)) return snapshot
			const matching = history.entries.filter(eligible)
			if (!matching.length) return snapshot
			const currentIndex =
				mode === 'live' ? matching.length - 1 : snapshot.entries.length - 1
			if (currentIndex < 0 && offset < 0) return snapshot
			const target = Math.max(
				0,
				Math.min(matching.length - 1, currentIndex + offset)
			)
			if (mode === 'paused' && offset > 0 && target === matching.length - 1)
				return goLive()
			if (mode === 'paused' && matching[target]!.id === anchorId)
				return snapshot
			if (mode === 'live') {
				mode = 'paused'
				baseline = Object.freeze({ ...history.stats.acceptedByLevel })
			}
			anchorId = matching[target]!.id
			return publish()
		},
		goLive
	})
}
