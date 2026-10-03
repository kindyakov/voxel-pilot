import type { InspectionEvent } from 'xstate'

/** Trusted native facts; never a portable UI/transport DTO or a complete saved trace. */
export interface NativeInspectionRecord {
	readonly sequence: number
	readonly observedAt: number
	readonly event: InspectionEvent
}

export interface NativeInspectionStats {
	readonly active: boolean
	readonly failed: boolean
	readonly queued: number
	readonly delivered: number
	readonly dropped: number
	readonly inFlight: boolean
}

/** These controls close only observation, independently of the bot or application. */
export interface NativeInspectionControls {
	detach(): void
	getStats(): NativeInspectionStats
}

export interface NativeInspectionObserver {
	next(record: NativeInspectionRecord): void | Promise<void>
	dispose?(): void | Promise<void>
}

export interface NativeInspectionOptions {
	/** A fresh observer for each actual HSM session, before native actor construction. */
	readonly createObserver: (
		controls: NativeInspectionControls
	) => NativeInspectionObserver
	/** Retained native references, default 1024; overflow drops the oldest queued fact. */
	readonly capacity?: number
	/** Callbacks per yielding task, default min(64, capacity). Async delivery is serial. */
	readonly batchSize?: number
}
