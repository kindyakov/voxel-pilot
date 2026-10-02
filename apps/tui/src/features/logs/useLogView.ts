import type { LogHistory } from '@voxel-pilot/contracts'
import { useLayoutEffect, useState, useSyncExternalStore } from 'react'

import { createLogViewStore } from './store.js'

interface HistorySource {
	getSnapshot(): { readonly history: LogHistory }
	subscribe(listener: () => void): () => void
}

/** Observes the existing app bridge, without another core telemetry membership. */
export function useLogView(source: HistorySource) {
	const [store] = useState(() =>
		createLogViewStore(source.getSnapshot().history)
	)
	useLayoutEffect(() => {
		const receive = () => store.receive(source.getSnapshot().history)
		const dispose = source.subscribe(receive)
		receive()
		return dispose
	}, [source, store])
	const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot)
	return { snapshot, actions: store }
}
