import type { LogHistory } from '@voxel-pilot/contracts'
import { createLogView } from '@voxel-pilot/presentation'

export function createLogViewStore(history: LogHistory) {
	const model = createLogView(history)
	const observers = new Set<{ listener: () => void }>()
	const change = (action: () => void) => {
		const before = model.getSnapshot()
		action()
		if (before === model.getSnapshot()) return
		for (const membership of [...observers]) {
			if (!observers.has(membership)) continue
			try {
				void Promise.resolve(membership.listener()).catch(() => {})
			} catch {}
		}
	}
	return Object.freeze({
		getSnapshot: model.getSnapshot,
		subscribe(listener: () => void) {
			const membership = { listener }
			observers.add(membership)
			return () => {
				observers.delete(membership)
			}
		},
		receive: (next: LogHistory) =>
			change(() => {
				model.receive(next)
			}),
		toggleDebug: () =>
			change(() => {
				model.toggleDebug()
			}),
		scroll: (offset: number) =>
			change(() => {
				model.scroll(offset)
			}),
		goLive: () =>
			change(() => {
				model.goLive()
			})
	})
}
