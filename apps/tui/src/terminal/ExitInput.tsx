import { useInput } from 'ink'

import type { LogNavigation } from './logNavigation.js'

export function ExitInput({
	onExit,
	onFailure,
	logs,
	pageSize = 1
}: {
	readonly onExit: () => void
	readonly onFailure: () => void
	readonly logs?: LogNavigation
	readonly pageSize?: number
}) {
	useInput((input, key) => {
		try {
			if (input === 'q' || (input === 'c' && key.ctrl)) {
				void Promise.resolve(onExit()).catch(onFailure)
			} else if (logs) {
				if (input === 'd' && !key.ctrl && !key.meta) logs.toggleDebug()
				else if (key.upArrow) logs.scroll(-1)
				else if (key.downArrow) logs.scroll(1)
				else if (key.pageUp) logs.scroll(-pageSize)
				else if (key.pageDown) logs.scroll(pageSize)
				else if (key.end) logs.goLive()
			}
		} catch {
			onFailure()
		}
	})
	return null
}
