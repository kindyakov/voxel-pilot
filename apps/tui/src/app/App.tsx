import type { LogViewSnapshot } from '@voxel-pilot/presentation'
import { Box, Text, useWindowSize } from 'ink'
import { type ComponentType, useSyncExternalStore } from 'react'

import { ConnectionPanel } from '../features/connection/index.js'
import { LogPanel, useLogView } from '../features/logs/index.js'
import { type StatusClock, StatusPanel } from '../features/status/index.js'
import type {
	TelemetryStore,
	TelemetryView
} from '../runtime/telemetryStore.js'
import { useTelemetry } from '../runtime/useTelemetry.js'
import { ExitInput } from '../terminal/ExitInput.js'
import {
	type TerminalCapabilities,
	asciiBorder
} from '../terminal/capabilities.js'
import type { DisplayClock } from '../terminal/display.js'
import { compactDisplayText } from '../terminal/display.js'
import { type TerminalLayout, terminalLayout } from '../terminal/layout.js'
import { FailureBoundary } from '../ui/FailureBoundary.js'
import { Header } from '../ui/Header.js'
import type { ApplicationState, ApplicationStore } from './state.js'

export interface DashboardProps {
	readonly telemetry: TelemetryView
	readonly application: ApplicationState
	readonly displayClock: DisplayClock
	readonly statusClock?: StatusClock
	readonly logView: LogViewSnapshot
	readonly layout: TerminalLayout
	readonly capabilities: TerminalCapabilities
}

export function Dashboard({
	telemetry,
	application,
	displayClock,
	statusClock,
	logView,
	layout,
	capabilities
}: DashboardProps) {
	const { columns, rows, contentColumns: width } = layout
	const { color, unicode } = capabilities
	const status =
		application.phase === 'stopping'
			? 'STOPPING'
			: telemetry.snapshot.connection.state.toUpperCase()
	const clip = (text: string) => compactDisplayText(text, width, unicode)
	const statusColor =
		application.phase === 'stopping'
			? 'yellow'
			: application.failure
				? 'red'
				: telemetry.snapshot.connection.state === 'ready'
					? 'green'
					: 'yellow'
	const border = rows >= 3 && columns >= 5
	const tinyRows = Math.max(1, rows - (border ? 2 : 0))
	const exitColumns = border ? width : columns
	const tinyExit =
		exitColumns === 1
			? 'q'
			: exitColumns < 9
				? 'q / ^C'
				: unicode
					? 'q / Ctrl+C — выход'
					: 'q / Ctrl+C - выход'
	const footer = clip(
		unicode
			? 'q / Ctrl+C — выход · d DEBUG · ↑↓ PgUp/PgDn · End LIVE'
			: 'q / Ctrl+C - выход | d DEBUG | Up/Down PgUp/PgDn | End LIVE'
	)
	const logs = (
		<FailureBoundary fallback={<Text>Log view unavailable</Text>}>
			<LogPanel
				view={logView}
				rows={layout.logRows}
				columns={layout.logColumns}
				clock={displayClock}
				capabilities={capabilities}
			/>
		</FailureBoundary>
	)
	const facts = (
		<FailureBoundary fallback={<Text>Status view unavailable</Text>}>
			<StatusPanel
				snapshot={telemetry.snapshot}
				clock={statusClock}
				columns={layout.statusColumns}
				capabilities={capabilities}
			/>
		</FailureBoundary>
	)
	return (
		<Box
			flexDirection='column'
			width={columns}
			height={rows}
			borderStyle={border ? (unicode ? 'single' : asciiBorder) : undefined}
			borderColor={color ? 'gray' : undefined}
			paddingX={border ? 1 : 0}
			overflow='hidden'
		>
			{layout.mode === 'tiny' ? (
				<Box flexDirection='column' flexGrow={1} overflow='hidden'>
					{tinyRows >= 3 && (!application.failure || tinyRows >= 4) && (
						<Header
							status={status}
							columns={width}
							color={color}
							statusColor={statusColor}
							unicode={unicode}
						/>
					)}
					{tinyRows >= 3 && application.failure && (
						<Text wrap='truncate-end'>{clip(application.failure.message)}</Text>
					)}
					{tinyRows >= 2 && (
						<Text wrap='truncate-end'>{clip('Увеличьте окно терминала')}</Text>
					)}
					<Box flexGrow={1} />
					<Text wrap='truncate-end'>
						{compactDisplayText(tinyExit, exitColumns, unicode)}
					</Text>
				</Box>
			) : (
				<>
					<Header
						status={status}
						columns={width}
						color={color}
						statusColor={statusColor}
						unicode={unicode}
						right={clip(`ЛОГИ · ${logView.mode.toUpperCase()}`)}
					/>
					<Text
						wrap='truncate-end'
						color={
							color && application.phase === 'stopping' ? 'yellow' : undefined
						}
					>
						{clip(application.message)}
					</Text>
					<FailureBoundary fallback={<Text>Connection view unavailable</Text>}>
						<ConnectionPanel
							connection={telemetry.snapshot.connection}
							failure={application.failure}
							columns={width}
							capabilities={capabilities}
						/>
					</FailureBoundary>
					<Box
						height={layout.contentRows}
						flexShrink={0}
						flexDirection={layout.mode === 'wide' ? 'row' : 'column'}
						overflow='hidden'
					>
						{layout.mode === 'wide' ? (
							<>
								<Box width={layout.logColumns} height={layout.contentRows}>
									{logs}
								</Box>
								<Box width={3} justifyContent='center'>
									<Text color={color ? 'gray' : undefined}>
										{Array(layout.contentRows)
											.fill(unicode ? '│' : '|')
											.join('\n')}
									</Text>
								</Box>
								<Box width={layout.statusColumns} flexDirection='column'>
									{facts}
								</Box>
							</>
						) : (
							<>
								<Box height={10} flexShrink={0} flexDirection='column'>
									{facts}
								</Box>
								<Text dimColor={color}>
									{(unicode ? '─' : '-').repeat(width)}
								</Text>
								{logs}
							</>
						)}
					</Box>
					<Text dimColor={color} wrap='truncate-end'>
						{footer}
					</Text>
				</>
			)}
		</Box>
	)
}

export function App({
	telemetry,
	application,
	displayClock,
	statusClock,
	capabilities,
	onExit,
	onFatal,
	view: View = Dashboard
}: {
	readonly telemetry: TelemetryStore
	readonly application: ApplicationStore
	readonly displayClock: DisplayClock
	readonly statusClock?: StatusClock
	readonly capabilities: TerminalCapabilities
	readonly onExit: () => void
	readonly onFatal: () => void
	readonly view?: ComponentType<DashboardProps>
}) {
	const current = useTelemetry(telemetry)
	const logs = useLogView(telemetry)
	const state = useSyncExternalStore(
		application.subscribe,
		application.getSnapshot
	)
	const { columns, rows } = useWindowSize()
	const layout = terminalLayout(columns, rows, state.failure !== null)
	return (
		<>
			<ExitInput
				onExit={onExit}
				onFailure={onFatal}
				logs={logs.actions}
				pageSize={layout.logRows}
			/>
			<FailureBoundary
				onFailure={onFatal}
				fallback={
					<Text
						wrap='truncate-end'
						color={capabilities.color ? 'red' : undefined}
					>
						{compactDisplayText(
							'TUI failed. Stopping… q / Ctrl+C — выход',
							columns,
							capabilities.unicode
						)}
					</Text>
				}
			>
				<View
					telemetry={current}
					application={state}
					displayClock={displayClock}
					statusClock={statusClock}
					logView={logs.snapshot}
					layout={layout}
					capabilities={capabilities}
				/>
			</FailureBoundary>
		</>
	)
}
