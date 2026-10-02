import type { LogViewSnapshot } from '@voxel-pilot/presentation'
import { Box, Text } from 'ink'

import {
	type DisplayClock,
	compactDisplayText,
	compactLogMessage
} from '../../terminal/display.js'

export { useLogView } from './useLogView.js'

export function LogPanel({
	view,
	rows,
	columns,
	clock
}: {
	readonly view: LogViewSnapshot
	readonly rows: number
	readonly columns: number
	readonly clock: DisplayClock
}) {
	const visible = view.entries.slice(-rows)
	const filter = view.includeDebug ? 'DEBUG' : 'INFO+'
	const title = `ЖУРНАЛ · ${filter} · ${view.mode.toUpperCase()}${view.mode === 'paused' ? ` · +${view.newCount} новых` : ''}`
	const loss = `${view.anchorLost ? 'ЯКОРЬ УТРАЧЕН · ' : ''}Вытеснено: ${view.evictedEntries} · усечено: ${view.truncatedEntries}`
	const width = Math.max(1, columns - 4)
	return (
		<Box flexDirection='column' flexGrow={1}>
			<Text bold>{compactDisplayText(title, width)}</Text>
			<Text
				dimColor={!view.anchorLost}
				color={view.anchorLost ? 'yellow' : undefined}
			>
				{compactDisplayText(loss, width)}
			</Text>
			{visible.map(entry => (
				<Box key={entry.id} flexShrink={0}>
					<Box width={2}>
						<Text color='cyan'>
							{view.mode === 'paused' && entry.id === view.displayAnchorId
								? '› '
								: '  '}
						</Text>
					</Box>
					<Box width={9}>
						<Text wrap='truncate-end'>
							{compactDisplayText(clock.formatTimestamp(entry.timestamp), 8)}
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
						<Text wrap='truncate-end'>
							{compactDisplayText(entry.source, 11)}
						</Text>
					</Box>
					<Box flexGrow={1} flexShrink={1}>
						<Text wrap='truncate-end'>
							{compactLogMessage(
								entry.message,
								Math.max(1, width - 29),
								entry.truncation !== null
							)}
						</Text>
					</Box>
				</Box>
			))}
			{!visible.length && <Text dimColor>Нет записей {filter}</Text>}
		</Box>
	)
}
