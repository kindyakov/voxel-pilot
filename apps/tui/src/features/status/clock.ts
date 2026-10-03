/** Epoch milliseconds for display, separate from the application's shutdown deadline. */
export interface StatusClock {
	now(): number
	schedule(callback: () => void, milliseconds: number): () => void
}

export const defaultStatusClock: StatusClock = {
	now: Date.now,
	schedule(callback, milliseconds) {
		const timer = setTimeout(callback, milliseconds)
		return () => {
			clearTimeout(timer)
		}
	}
}
