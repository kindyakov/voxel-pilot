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

export interface BotTelemetry {
	getSnapshot(): BotSnapshot
	/** Immediately delivers the cached snapshot; disposer prevents later delivery. */
	subscribe(listener: (snapshot: BotSnapshot) => void): () => void
}

export interface BotRuntime {
	readonly telemetry: BotTelemetry
	start(): void
	stop(reason?: string): Promise<StopResult>
}
