import { Box, Text, useWindowSize } from 'ink'
import { type ComponentType, useSyncExternalStore } from 'react'

import { ConnectionPanel } from '../features/connection/index.js'
import { LogPanel } from '../features/logs/index.js'
import type {
	TelemetryStore,
	TelemetryView
} from '../runtime/telemetryStore.js'
import { useTelemetry } from '../runtime/useTelemetry.js'
import { ExitInput } from '../terminal/ExitInput.js'
import type { DisplayClock } from '../terminal/display.js'
import { FailureBoundary } from '../ui/FailureBoundary.js'
import { Header } from '../ui/Header.js'
import type { ApplicationState, ApplicationStore } from './state.js'

export interface DashboardProps {
	readonly telemetry: TelemetryView
	readonly application: ApplicationState
	readonly displayClock: DisplayClock
}

export function Dashboard({
	telemetry,
	application,
	displayClock
}: DashboardProps) {
	const { columns, rows } = useWindowSize()
	const small = columns < 50 || rows < 9
	return (
		<Box
			flexDirection='column'
			width={columns}
			height={rows}
			borderStyle='single'
			borderColor='gray'
			paddingX={1}
		>
			<Header
				status={
					application.phase === 'stopping'
						? 'STOPPING'
						: telemetry.snapshot.connection.state.toUpperCase()
				}
			/>
			<Text color={application.phase === 'stopping' ? 'yellow' : undefined}>
				{application.message}
			</Text>
			{small ? (
				<Box flexGrow={1}>
					<Text>Увеличьте окно терминала</Text>
				</Box>
			) : (
				<Box flexDirection='column' flexGrow={1}>
					<FailureBoundary
						fallback={<Text color='yellow'>Connection view unavailable</Text>}
					>
						<ConnectionPanel
							connection={telemetry.snapshot.connection}
							failure={application.failure}
						/>
					</FailureBoundary>
					<FailureBoundary
						fallback={<Text color='yellow'>Log view unavailable</Text>}
					>
						<LogPanel
							history={telemetry.history}
							rows={Math.max(1, rows - 9)}
							clock={displayClock}
						/>
					</FailureBoundary>
				</Box>
			)}
			<Text dimColor>q / Ctrl+C — выход</Text>
		</Box>
	)
}

export function App({
	telemetry,
	application,
	displayClock,
	onExit,
	onFatal,
	view: View = Dashboard
}: {
	readonly telemetry: TelemetryStore
	readonly application: ApplicationStore
	readonly displayClock: DisplayClock
	readonly onExit: () => void
	readonly onFatal: () => void
	readonly view?: ComponentType<DashboardProps>
}) {
	const current = useTelemetry(telemetry)
	const state = useSyncExternalStore(
		application.subscribe,
		application.getSnapshot
	)
	return (
		<>
			<ExitInput onExit={onExit} onFailure={onFatal} />
			<FailureBoundary
				onFailure={onFatal}
				fallback={
					<Text color='red'>TUI failed. Stopping… q / Ctrl+C — выход</Text>
				}
			>
				<View
					telemetry={current}
					application={state}
					displayClock={displayClock}
				/>
			</FailureBoundary>
		</>
	)
}
