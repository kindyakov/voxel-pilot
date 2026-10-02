export interface DeadlineClock {
	now(): number
	schedule(callback: () => void, milliseconds: number): () => void
}

export const defaultDeadlineClock: DeadlineClock = {
	now: Date.now,
	schedule(callback, milliseconds) {
		const timer = setTimeout(callback, milliseconds)
		return () => {
			clearTimeout(timer)
		}
	}
}
