import type { LogHistory } from '@voxel-pilot/contracts'
import { Box, Text } from 'ink'

import { type DisplayClock, safeDisplayText } from '../../terminal/display.js'

export function LogPanel({
	history,
	rows,
	clock
}: {
	readonly history: LogHistory
	readonly rows: number
	readonly clock: DisplayClock
}) {
	const visible = history.entries
		.filter(entry => entry.level !== 'debug')
		.slice(-rows)
	return (
		<Box flexDirection='column' flexGrow={1}>
			<Text bold>ЖУРНАЛ · INFO+</Text>
			{visible.map(entry => (
				<Box key={entry.id} flexShrink={0}>
					<Box width={9}>
						<Text wrap='truncate-end'>
							{safeDisplayText(clock.formatTimestamp(entry.timestamp))}
						</Text>
					</Box>
					<Box width={6}>
						<Text
							color={
								entry.level === 'error'
									? 'red'
									: entry.level === 'warn'
										? 'yellow'
										: undefined
							}
						>
							{entry.level.toUpperCase()}
						</Text>
					</Box>
					<Box width={12}>
						<Text wrap='truncate-end'>{safeDisplayText(entry.source)}</Text>
					</Box>
					<Box flexGrow={1} flexShrink={1}>
						<Text wrap='truncate-end'>{safeDisplayText(entry.message)}</Text>
					</Box>
				</Box>
			))}
			{!visible.length && <Text dimColor>Нет записей INFO+</Text>}
		</Box>
	)
}
