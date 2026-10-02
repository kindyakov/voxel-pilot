import { useEffect, useState } from 'react'

import type { StatusClock } from './clock.js'

/** One cancellable display schedule. It never publishes a runtime or HSM update. */
export function useStatusNow(clock: StatusClock): number {
	const [sample, setSample] = useState(() => ({ clock, now: clock.now() }))
	const [failed, setFailed] = useState(false)
	useEffect(() => {
		let active = true
		let cancel = () => {}
		const refresh = () => {
			if (!active) return
			try {
				setSample({ clock, now: clock.now() })
				cancel = clock.schedule(refresh, 1000)
			} catch {
				// Deliver asynchronous port failure through the local render boundary.
				setFailed(true)
			}
		}
		refresh()
		return () => {
			active = false
			cancel()
		}
	}, [clock])
	if (failed) throw new Error('Status display clock unavailable')
	return sample.clock === clock ? sample.now : clock.now()
}
