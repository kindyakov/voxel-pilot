export type ConnectionState =
	| 'idle'
	| 'connecting'
	| 'ready'
	| 'reconnecting'
	| 'stopping'
	| 'stopped'
	| 'failed'

export interface RuntimeProblem {
	readonly code: string
	readonly message: string
}

export interface ConnectionSnapshot {
	readonly state: ConnectionState
	readonly changedAt: number
	readonly sessionId: number | null
	readonly retryAttempt: number
	readonly retryAt: number | null
	readonly failure: RuntimeProblem | null
}

export interface Measurement<T> {
	readonly value: T | null
	readonly updatedAt: number | null
	readonly stale: boolean
}

export interface Position {
	readonly x: number
	readonly y: number
	readonly z: number
}

export type GoalSummary =
	| { readonly status: 'none'; readonly text: null }
	| { readonly status: 'active' | 'paused'; readonly text: string }

export interface HarnessSummary {
	readonly mainActivity: string
	readonly enteredAt: number
	readonly monitoring: readonly string[]
	readonly action: string | null
	readonly goal: GoalSummary
}

export interface BotSnapshot {
	readonly revision: number
	readonly connection: ConnectionSnapshot
	readonly health: Measurement<number>
	readonly maxHealth: Measurement<number>
	readonly food: Measurement<number>
	readonly position: Measurement<Position>
	readonly harness: Measurement<HarnessSummary>
}

export interface StopIssue extends RuntimeProblem {
	readonly stage: 'save' | 'cleanup' | 'connection' | 'deadline'
}

export interface StopResult {
	readonly outcome: 'stopped' | 'failed' | 'timed-out'
	readonly persistence: 'saved' | 'not-required' | 'failed' | 'incomplete'
	readonly issues: readonly StopIssue[]
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface LogEntry {
	/** Opaque identity; eviction/filtering never renumbers entries. */
	readonly id: string
	readonly timestamp: number
	readonly level: LogLevel
	readonly source: string
	readonly message: string
	readonly truncation: Readonly<{ originalMessageBytes: number }> | null
}

export interface LogHistoryLimits {
	readonly maxEntries: number
	readonly maxBytes: number
	readonly maxEntryBytes: number
}

export interface LogHistoryStats {
	readonly retainedEntries: number
	/** Sum of UTF-8 JSON bytes of retained safe entries, excluding snapshot envelope. */
	readonly retainedBytes: number
	readonly acceptedEntries: number
	readonly acceptedByLevel: Readonly<Record<LogLevel, number>>
	readonly evictedEntries: number
	readonly evictedBytes: number
	readonly truncatedEntries: number
}

export interface LogHistory {
	/** Identity of this runtime's journal, preserved across explicit restart. */
	readonly id: string
	readonly revision: number
	readonly level: LogLevel
	readonly limits: LogHistoryLimits
	readonly entries: readonly LogEntry[]
	readonly stats: LogHistoryStats
}

export type LogUpdate =
	| { readonly kind: 'snapshot'; readonly history: LogHistory }
	| {
			readonly kind: 'append'
			readonly entry: LogEntry
			readonly history: LogHistory
	  }

export interface BotTelemetry {
	getSnapshot(): BotSnapshot
	/** Immediately delivers the cached snapshot; disposer prevents later delivery. */
	subscribe(listener: (snapshot: BotSnapshot) => void): () => void
	getLogHistory(): LogHistory
	/** Initial history, then appends. A reentrant newer revision supersedes older delivery. */
	subscribeLogs(listener: (update: LogUpdate) => void): () => void
}

export interface BotRuntime {
	readonly telemetry: BotTelemetry
	start(): void
	stop(reason?: string): Promise<StopResult>
}
