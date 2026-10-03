import type {
	BotSnapshot,
	BotTelemetry,
	LogHistory
} from '@voxel-pilot/contracts'

export interface TelemetryView {
	readonly snapshot: BotSnapshot
	readonly history: LogHistory
}

/** One current reference per public channel; source history remains in core. */
export function createTelemetryStore(telemetry: BotTelemetry) {
	let current: TelemetryView = Object.freeze({
		snapshot: telemetry.getSnapshot(),
		history: telemetry.getLogHistory()
	})
	let disposed = false
	let disposeSnapshot = () => {},
		disposeLogs = () => {}
	const observers = new Set<{ listener: () => void }>()
	const update = (next: TelemetryView) => {
		if (
			disposed ||
			(next.snapshot === current.snapshot && next.history === current.history)
		)
			return
		current = Object.freeze(next)
		for (const observer of [...observers]) {
			if (!observers.has(observer)) continue
			try {
				void Promise.resolve(observer.listener()).catch(() => {})
			} catch {}
		}
	}
	const dispose = () => {
		if (disposed) return
		disposed = true
		disposeSnapshot()
		disposeLogs()
		observers.clear()
	}
	try {
		disposeSnapshot = telemetry.subscribe(snapshot =>
			update({ ...current, snapshot })
		)
		disposeLogs = telemetry.subscribeLogs(value =>
			update({ ...current, history: value.history })
		)
	} catch (error) {
		dispose()
		throw error
	}
	return Object.freeze({
		getSnapshot: () => current,
		subscribe(listener: () => void) {
			const subscription = { listener }
			if (!disposed) observers.add(subscription)
			return () => {
				observers.delete(subscription)
			}
		},
		dispose
	})
}

export type TelemetryStore = ReturnType<typeof createTelemetryStore>
