import type { RuntimeProblem } from '@voxel-pilot/contracts'

export interface ApplicationState {
	readonly phase: 'starting' | 'running' | 'stopping'
	readonly message: string
	readonly deadline: number | null
	readonly failure: RuntimeProblem | null
}

export function createApplicationState() {
	let current: ApplicationState = Object.freeze({
		phase: 'starting',
		message: 'Starting',
		deadline: null,
		failure: null
	})
	const observers = new Set<{ listener: () => void }>()
	return {
		getSnapshot: () => current,
		subscribe(listener: () => void) {
			const subscription = { listener }
			observers.add(subscription)
			return () => {
				observers.delete(subscription)
			}
		},
		update(next: Partial<ApplicationState>) {
			current = Object.freeze({ ...current, ...next })
			for (const observer of [...observers]) {
				if (!observers.has(observer)) continue
				try {
					void Promise.resolve(observer.listener()).catch(() => {})
				} catch {}
			}
		}
	}
}

export type ApplicationStore = ReturnType<typeof createApplicationState>
