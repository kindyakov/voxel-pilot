import type { LogViewSnapshot } from '@voxel-pilot/presentation'
import { Box, Text } from 'ink'

import type { TerminalCapabilities } from '../../terminal/capabilities.js'
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
	clock,
	capabilities = { color: true, unicode: true }
}: {
	readonly view: LogViewSnapshot
	readonly rows: number
	readonly columns: number
	readonly clock: DisplayClock
	readonly capabilities?: TerminalCapabilities
}) {
	const visible = view.entries.slice(-rows)
	const filter = view.includeDebug ? 'DEBUG' : 'INFO+'
	const title = `ЖУРНАЛ · ${filter} · ${view.mode.toUpperCase()}${view.mode === 'paused' ? ` · +${view.newCount} новых` : ''}`
	const loss = `${view.anchorLost ? 'ЯКОРЬ УТРАЧЕН · ' : ''}Вытеснено: ${view.evictedEntries} · усечено: ${view.truncatedEntries}`
	const width = Math.max(1, columns)
	const { color, unicode } = capabilities
	const clip = (text: string, cells = width) =>
		compactDisplayText(text, cells, unicode)
	return (
		<Box flexDirection='column' flexGrow={1} width={width}>
			<Text bold={color} wrap='truncate-end'>
				{clip(title)}
			</Text>
			<Text
				dimColor={color && !view.anchorLost}
				color={color && view.anchorLost ? 'yellow' : undefined}
				wrap='truncate-end'
			>
				{clip(loss)}
			</Text>
			<Text dimColor={color} wrap='truncate-end'>
				{clip('  Время    Уров. Источник    Сообщение')}
			</Text>
			{visible.map(entry => (
				<Box key={entry.id} flexShrink={0}>
					<Box width={2}>
						<Text color={color ? 'magenta' : undefined}>
							{view.mode === 'paused' && entry.id === view.displayAnchorId
								? unicode
									? '› '
									: '> '
								: '  '}
						</Text>
					</Box>
					<Box width={9}>
						<Text wrap='truncate-end'>
							{clip(clock.formatTimestamp(entry.timestamp), 8)}
						</Text>
					</Box>
					<Box width={6}>
						<Text
							color={
								!color
									? undefined
									: entry.level === 'error'
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
						<Text
							color={color && entry.source === 'HSM' ? 'magenta' : undefined}
							wrap='truncate-end'
						>
							{clip(entry.source, 11)}
						</Text>
					</Box>
					<Box flexGrow={1} flexShrink={1}>
						<Text wrap='truncate-end'>
							{compactLogMessage(
								entry.message,
								Math.max(1, width - 29),
								entry.truncation !== null,
								unicode
							)}
						</Text>
					</Box>
				</Box>
			))}
			{!visible.length && <Text dimColor={color}>Нет записей {filter}</Text>}
		</Box>
	)
}
