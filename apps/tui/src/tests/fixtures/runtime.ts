import { EventEmitter } from 'node:events'

import type {
	BotRuntime,
	BotSnapshot,
	ConnectionState,
	LogEntry,
	LogHistory,
	LogUpdate,
	RuntimeProblem,
	StopResult
} from '@voxel-pilot/contracts'

export function deferred<T>() {
	let resolve!: (value: T) => void, reject!: (reason?: unknown) => void
	const promise = new Promise<T>((done, fail) => {
		resolve = done
		reject = fail
	})
	return { promise, resolve, reject }
}

export const saved: StopResult = Object.freeze({
	outcome: 'stopped',
	persistence: 'saved',
	issues: []
})
const unknown = Object.freeze({ value: null, updatedAt: null, stale: false })

export function publicRuntime() {
	let snapshot: BotSnapshot = Object.freeze({
		revision: 0,
		connection: Object.freeze({
			state: 'idle',
			changedAt: 0,
			sessionId: null,
			retryAttempt: 0,
			retryAt: null,
			failure: null
		}),
		health: unknown,
		maxHealth: unknown,
		food: unknown,
		position: unknown,
		harness: unknown
	})
	const snapshots = new Set<{ listener: (value: BotSnapshot) => void }>()
	const logs = new Set<{ listener: (value: LogUpdate) => void }>()
	let accepted = 0
	const historyFor = (entries: readonly LogEntry[]): LogHistory =>
		Object.freeze({
			id: 'public-fixture',
			revision: accepted,
			level: 'debug',
			limits: { maxEntries: 32, maxBytes: 65536, maxEntryBytes: 4096 },
			entries,
			stats: {
				retainedEntries: entries.length,
				retainedBytes: entries.reduce(
					(sum, entry) => sum + Buffer.byteLength(JSON.stringify(entry)),
					0
				),
				acceptedEntries: accepted,
				acceptedByLevel: {
					debug: entries.filter(entry => entry.level === 'debug').length,
					info: entries.filter(entry => entry.level === 'info').length,
					warn: entries.filter(entry => entry.level === 'warn').length,
					error: entries.filter(entry => entry.level === 'error').length
				},
				evictedEntries: 0,
				evictedBytes: 0,
				truncatedEntries: 0
			}
		})
	let history = historyFor([])
	let startCalls = 0,
		stopCalls = 0,
		snapshotSubscriptions = 0,
		logSubscriptions = 0
	let stopPromise: Promise<StopResult> | undefined
	let stopResult: Promise<StopResult> = Promise.resolve(saved)
	const stopStarted = deferred<void>()
	const deliver = <T>(listener: (value: T) => void, value: T) => {
		try {
			void Promise.resolve(listener(value)).catch(() => {})
		} catch {}
	}
	const connection = (
		state: ConnectionState,
		failure: RuntimeProblem | null = null
	) => {
		snapshot = Object.freeze({
			...snapshot,
			revision: snapshot.revision + 1,
			connection: Object.freeze({
				...snapshot.connection,
				state,
				changedAt: snapshot.revision + 1,
				failure
			})
		})
		for (const subscription of [...snapshots])
			deliver(subscription.listener, snapshot)
	}
	const runtime: BotRuntime = {
		start() {
			startCalls++
			connection('connecting')
		},
		stop() {
			if (!stopPromise) {
				stopCalls++
				connection('stopping')
				stopStarted.resolve()
				stopPromise = stopResult.then(result => {
					connection('stopped')
					return result
				})
			}
			return stopPromise
		},
		telemetry: {
			getSnapshot: () => snapshot,
			getLogHistory: () => history,
			subscribe(listener) {
				snapshotSubscriptions++
				const subscription = { listener }
				snapshots.add(subscription)
				deliver(listener, snapshot)
				return () => {
					snapshots.delete(subscription)
				}
			},
			subscribeLogs(listener) {
				logSubscriptions++
				const subscription = { listener }
				logs.add(subscription)
				deliver(listener, { kind: 'snapshot', history })
				return () => {
					logs.delete(subscription)
				}
			}
		}
	}
	return {
		runtime,
		signals: new EventEmitter(),
		connection,
		stopStarted,
		holdStop(value: Promise<StopResult>) {
			stopResult = value
		},
		append(message: string, level: LogEntry['level'] = 'info') {
			accepted++
			const entry: LogEntry = Object.freeze({
				id: `log:${accepted}`,
				timestamp: 1000 + accepted,
				level,
				source: 'CORE',
				message,
				truncation: null
			})
			history = historyFor(
				Object.freeze([...history.entries, entry].slice(-32))
			)
			for (const subscription of [...logs])
				deliver(subscription.listener, { kind: 'append', entry, history })
		},
		counts() {
			return {
				startCalls,
				stopCalls,
				snapshotSubscriptions,
				logSubscriptions,
				activeSnapshots: snapshots.size,
				activeLogs: logs.size
			}
		}
	}
}
