import { useInput, useWindowSize } from 'ink'

import { type LogNavigation, logPageSize } from './logNavigation.js'

export function ExitInput({
	onExit,
	onFailure,
	logs
}: {
	readonly onExit: () => void
	readonly onFailure: () => void
	readonly logs?: LogNavigation
}) {
	const { rows } = useWindowSize()
	useInput((input, key) => {
		try {
			if (input === 'q' || (input === 'c' && key.ctrl)) {
				void Promise.resolve(onExit()).catch(onFailure)
			} else if (logs) {
				if (input === 'd' && !key.ctrl && !key.meta) logs.toggleDebug()
				else if (key.upArrow) logs.scroll(-1)
				else if (key.downArrow) logs.scroll(1)
				else if (key.pageUp) logs.scroll(-logPageSize(rows))
				else if (key.pageDown) logs.scroll(logPageSize(rows))
				else if (key.end) logs.goLive()
			}
		} catch {
			onFailure()
		}
	})
	return null
}
