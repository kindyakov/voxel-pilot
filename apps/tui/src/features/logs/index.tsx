import type { LogViewSnapshot } from '@voxel-pilot/presentation'
import { Box, Text } from 'ink'

import type { TerminalCapabilities } from '../../terminal/capabilities.js'
import {
	type DisplayClock,
	compactDisplayText,
	compactLogMessage
} from '../../terminal/display.js'
import { palette } from '../../ui/palette.js'

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
	const mode = ` · ${filter} · ${view.mode.toUpperCase()}${view.mode === 'paused' ? ` · +${view.newCount} новых` : ''}`
	const loss = `${view.anchorLost ? 'ЯКОРЬ УТРАЧЕН · ' : ''}Вытеснено: ${view.evictedEntries} · усечено: ${view.truncatedEntries}`
	const width = Math.max(1, columns)
	const { color, unicode } = capabilities
	const clip = (text: string, cells = width) =>
		compactDisplayText(text, cells, unicode)
	return (
		<Box flexDirection='column' flexGrow={1} width={width}>
			<Text color={color ? palette.foreground : undefined} wrap='truncate-end'>
				<Text bold={color}>{clip('ЖУРНАЛ')}</Text>
				<Text color={color ? palette.muted : undefined}>
					{clip(mode, Math.max(0, width - 6))}
				</Text>
			</Text>
			<Text
				color={
					color ? (view.anchorLost ? palette.yellow : palette.muted) : undefined
				}
				wrap='truncate-end'
			>
				{clip(loss)}
			</Text>
			<Text color={color ? palette.muted : undefined} wrap='truncate-end'>
				{clip('  Время      Уровень Источник       Сообщение')}
			</Text>
			{visible.map(entry => (
				<Box
					key={entry.id}
					width={width}
					flexShrink={0}
					backgroundColor={
						color && view.mode === 'paused' && entry.id === view.displayAnchorId
							? palette.selection
							: undefined
					}
				>
					<Box width={2}>
						<Text color={color ? palette.pink : undefined}>
							{view.mode === 'paused' && entry.id === view.displayAnchorId
								? unicode
									? '› '
									: '> '
								: '  '}
						</Text>
					</Box>
					<Box width={11}>
						<Text color={color ? palette.muted : undefined} wrap='truncate-end'>
							{clip(clock.formatTimestamp(entry.timestamp), 8)}
						</Text>
					</Box>
					<Box width={8}>
						<Text
							color={
								!color
									? undefined
									: entry.level === 'error'
										? palette.red
										: entry.level === 'warn'
											? palette.yellow
											: entry.level === 'debug'
												? palette.muted
												: palette.foreground
							}
						>
							{entry.level.toUpperCase()}
						</Text>
					</Box>
					<Box width={15}>
						<Text
							color={
								color
									? entry.source === 'HSM'
										? palette.pink
										: palette.foreground
									: undefined
							}
							wrap='truncate-end'
						>
							{clip(entry.source, 12)}
						</Text>
					</Box>
					<Box flexGrow={1} flexShrink={1}>
						<Text
							color={
								color
									? entry.level === 'debug'
										? palette.muted
										: palette.foreground
									: undefined
							}
							wrap='truncate-end'
						>
							{compactLogMessage(
								entry.message,
								Math.max(1, width - 36),
								entry.truncation !== null,
								unicode
							)}
						</Text>
					</Box>
				</Box>
			))}
			{!visible.length && (
				<Text color={color ? palette.muted : undefined}>
					Нет записей {filter}
				</Text>
			)}
		</Box>
	)
}
