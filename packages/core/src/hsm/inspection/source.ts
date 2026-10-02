import type { InspectionEvent } from 'xstate'

import type { RuntimeLogger } from '@/config/runtimeLogger.js'

import type {
	NativeInspectionControls,
	NativeInspectionObserver,
	NativeInspectionOptions,
	NativeInspectionRecord
} from './index.js'

export interface CapturedInspectionOptions {
	readonly createObserver: NativeInspectionOptions['createObserver']
	readonly capacity: number
	readonly batchSize: number
}

/** Validate/capture composition without allocating any observation resources. */
export function captureInspectionOptions(
	options?: NativeInspectionOptions
): CapturedInspectionOptions | undefined {
	if (options === undefined) return undefined
	const capacity = options.capacity === undefined ? 1024 : options.capacity
	const batchSize =
		options.batchSize === undefined ? Math.min(64, capacity) : options.batchSize
	if (
		typeof options.createObserver !== 'function' ||
		!Number.isSafeInteger(capacity) ||
		capacity <= 0 ||
		capacity > 65_536 ||
		!Number.isSafeInteger(batchSize) ||
		batchSize <= 0 ||
		batchSize > capacity
	) {
		throw new Error(
			'Inspection requires createObserver, capacity 1..65536 and batchSize 1..capacity.'
		)
	}
	return Object.freeze({
		createObserver: options.createObserver,
		capacity,
		batchSize
	})
}

export interface NativeInspectionSource {
	inspect(event: InspectionEvent): void
	dispose(): void
}

/** Internal testing seam. Scheduling must yield; its disposer cancels that task. */
export type InspectionScheduler = (task: () => void) => () => void

const scheduleTask: InspectionScheduler = task => {
	const timer = setImmediate(task)
	timer.unref()
	return () => clearImmediate(timer)
}

/** A finite native source, separate from compact telemetry and general log history. */
export function createNativeInspectionSource(
	options: CapturedInspectionOptions,
	logger: RuntimeLogger,
	schedule: InspectionScheduler = scheduleTask
): NativeInspectionSource {
	const { capacity, batchSize } = options
	const queue = new Array<NativeInspectionRecord | undefined>(capacity)
	let head = 0,
		count = 0,
		sequence = 0,
		delivered = 0,
		dropped = 0
	let active = true,
		failed = false,
		inFlight = false
	let observer: NativeInspectionObserver | null = null
	let cancelTask: (() => void) | null = null
	const reportFailure = () => {
		if (failed) return
		failed = true
		try {
			logger.warn('[HSM] native inspection failed; observation detached.')
		} catch {
			// Even diagnostic output cannot affect the native event being processed.
		}
	}
	const closeObserver = (current: NativeInspectionObserver) => {
		try {
			// Cleanup is invoked once but never holds actor cancellation or persistence.
			void Promise.resolve(current.dispose?.()).catch(() => {
				// Record an old observer's cleanup failure without publishing late work.
				failed = true
			})
		} catch {
			reportFailure()
		}
	}
	const detach = () => {
		if (!active) return
		active = false
		const cancel = cancelTask
		cancelTask = null
		try {
			cancel?.()
		} catch {
			reportFailure()
		}
		queue.fill(undefined)
		head = count = 0
		inFlight = false
		const current = observer
		observer = null
		if (current) closeObserver(current)
	}
	const fail = () => {
		if (!active) return
		reportFailure()
		detach()
	}
	const requestDrain = () => {
		if (!active || !count || inFlight || cancelTask) return
		try {
			cancelTask = schedule(drain)
		} catch {
			fail()
		}
	}
	const drain = () => {
		cancelTask = null
		if (!active || inFlight) return
		for (
			let processed = 0;
			active && count && processed < batchSize;
			processed++
		) {
			const record = queue[head]!
			queue[head] = undefined
			head = (head + 1) % capacity
			count--
			try {
				delivered++
				const result = observer!.next(record)
				if (result) {
					// A void callback can accidentally be async. Keep only one in flight.
					inFlight = active
					void Promise.resolve(result).then(() => {
						if (!active) return
						inFlight = false
						requestDrain()
					}, fail)
					return
				}
			} catch {
				fail()
			}
		}
		requestDrain()
	}
	const controls: NativeInspectionControls = Object.freeze({
		detach,
		getStats: () =>
			Object.freeze({
				active,
				failed,
				queued: count,
				delivered,
				dropped,
				inFlight
			})
	})
	try {
		const created = options.createObserver(controls)
		if (active) observer = created
		else closeObserver(created)
	} catch {
		fail()
	}
	return Object.freeze({
		inspect(event: InspectionEvent) {
			if (!active) return
			if (count === capacity) {
				queue[head] = undefined
				head = (head + 1) % capacity
				count--
				dropped++
			}
			queue[(head + count) % capacity] = Object.freeze({
				sequence: ++sequence,
				observedAt: Date.now(),
				event
			})
			count++
			requestDrain()
		},
		dispose: detach
	})
}
