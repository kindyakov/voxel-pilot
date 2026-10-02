import { useSyncExternalStore } from 'react'

import type { TelemetryStore } from './telemetryStore.js'

export function useTelemetry(store: TelemetryStore) {
	return useSyncExternalStore(store.subscribe, store.getSnapshot)
}
