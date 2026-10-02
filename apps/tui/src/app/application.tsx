import type {
	BotRuntime,
	RuntimeProblem,
	StopResult
} from '@voxel-pilot/contracts'
import type { ComponentType } from 'react'

import type { StatusClock } from '../features/status/index.js'
import { createTelemetryStore } from '../runtime/telemetryStore.js'
import { type DisplayClock, defaultDisplayClock } from '../terminal/display.js'
import {
	type TerminalStreams,
	assertInteractiveTerminal
} from '../terminal/preflight.js'
import { createTerminalSession } from '../terminal/session.js'
import { App, type DashboardProps } from './App.js'
import { type TuiRuntimeOptions, createTuiRuntime } from './bootstrap.js'
import { type DeadlineClock, defaultDeadlineClock } from './clock.js'
import { createApplicationState } from './state.js'

export type { StatusClock } from '../features/status/index.js'

interface Signals {
	on(signal: 'SIGINT' | 'SIGTERM', listener: () => void): unknown
	off(signal: 'SIGINT' | 'SIGTERM', listener: () => void): unknown
}

export interface TuiResources {
	readonly runtime: BotRuntime
	readonly loggerHandle: { close(): Promise<void> }
}

export interface TuiApplicationOptions {
	readonly streams?: TerminalStreams
	readonly signals?: Signals
	/** Safe hosts/previews supply a public runtime without loading production settings. */
	readonly compose?: () => TuiResources
	readonly runtimeOptions?: TuiRuntimeOptions
	readonly shutdownTimeoutMs?: number
	readonly clock?: DeadlineClock
	readonly displayClock?: DisplayClock
	readonly statusClock?: StatusClock
	readonly view?: ComponentType<DashboardProps>
}

export interface TuiStopResult {
	readonly exitCode: number
	readonly runtime: StopResult | null
	readonly issues: readonly RuntimeProblem[]
}

/** One app owner joins input/signals/fatal exit around the sole core stop authority. */
export function startTuiApplication(options: TuiApplicationOptions = {}) {
	const timeout = options.shutdownTimeoutMs ?? 15_000
	if (
		!Number.isSafeInteger(timeout) ||
		timeout <= 0 ||
		timeout > 2_147_483_647
	) {
		throw new Error('shutdownTimeoutMs must be positive and finite')
	}
	const streams = options.streams ?? {
		stdin: process.stdin,
		stdout: process.stdout,
		stderr: process.stderr
	}
	assertInteractiveTerminal(streams)
	const signals = options.signals ?? process
	const clock = options.clock ?? defaultDeadlineClock
	const resources = (
		options.compose ?? (() => createTuiRuntime(options.runtimeOptions))
	)()
	const state = createApplicationState()
	let resolveDone!: (result: TuiStopResult) => void
	const done = new Promise<TuiStopResult>(resolve => {
		resolveDone = resolve
	})
	let shutdownPromise: Promise<TuiStopResult> | null = null
	let settled = false,
		failedConnection = false,
		fatal = false
	let runtimeResult: StopResult | null = null
	const issues: RuntimeProblem[] = []
	let cancelDeadline = () => {},
		disposeState = () => {}
	let store: ReturnType<typeof createTelemetryStore> | undefined
	let loggerClosing: Promise<void> | undefined
	const report = (message: string) => {
		try {
			streams.stderr.write(`${message}\n`)
		} catch {}
	}
	const issue = (code: string, message: string) => {
		if (!settled) issues.push(Object.freeze({ code, message }))
	}
	const closeLogger = () => {
		if (loggerClosing) return loggerClosing
		loggerClosing = (async () => {
			try {
				await resources.loggerHandle.close()
			} catch {
				issue(
					'logger-close-failed',
					'Application log output could not be closed successfully.'
				)
			}
		})()
		return loggerClosing
	}
	const session = createTerminalSession(streams, () => {
		void shutdown('fatal')
	})
	const onSignal = () => {
		void shutdown()
	}
	const settle = () => {
		if (settled) return
		settled = true
		cancelDeadline()
		disposeState()
		store?.dispose()
		signals.off('SIGINT', onSignal)
		signals.off('SIGTERM', onSignal)
		void session.dispose().catch(() => {})
		session.release()
		const exitCode =
			fatal ||
			failedConnection ||
			issues.length ||
			(runtimeResult && runtimeResult.outcome !== 'stopped')
				? 1
				: 0
		const result: TuiStopResult = Object.freeze({
			exitCode,
			runtime: runtimeResult,
			issues: Object.freeze([...issues])
		})
		if (exitCode) {
			const diagnostic =
				issues[0]?.message ??
				(fatal
					? 'TUI failed; runtime shutdown was requested.'
					: runtimeResult?.outcome === 'timed-out'
						? 'Runtime shutdown deadline exceeded; persistence may be incomplete.'
						: failedConnection
							? 'Connection failed.'
							: 'Runtime shutdown failed; persistence may be incomplete.')
			report(diagnostic)
		}
		resolveDone(result)
	}
	function shutdown(reason: 'exit' | 'fatal' = 'exit'): Promise<TuiStopResult> {
		if (reason === 'fatal' && !settled) fatal = true
		if (shutdownPromise) return shutdownPromise
		// Publish before any state delivery, stop callback or signal can reenter.
		shutdownPromise = done
		state.update({
			phase: 'stopping',
			message: `Stopping… awaiting persistence · deadline ${timeout / 1000}s`,
			deadline: clock.now() + timeout
		})
		cancelDeadline = clock.schedule(() => {
			issue(
				'application-shutdown-deadline',
				'Application shutdown deadline exceeded; persistence and resource cleanup may be incomplete.'
			)
			state.update({
				message: 'Shutdown deadline exceeded; persistence may be incomplete.'
			})
			void closeLogger()
			settle()
		}, timeout)
		void (async () => {
			try {
				const result = await resources.runtime.stop(
					reason === 'fatal' ? 'TUI application failure' : 'TUI exit'
				)
				if (!settled) {
					runtimeResult = result
					state.update({
						message:
							result.outcome === 'stopped'
								? `Stopped · persistence ${result.persistence}`
								: 'Runtime shutdown failed or reached its deadline; persistence may be incomplete.'
					})
				}
			} catch {
				issue(
					'runtime-stop-failed',
					'Runtime shutdown failed; persistence may be incomplete.'
				)
			}
			await closeLogger()
			if (settled) return
			try {
				await session.flush()
				await session.dispose()
			} catch {
				fatal = true
				issue(
					'terminal-close-failed',
					'Terminal cleanup failed; terminal state may be incomplete.'
				)
			}
			settle()
		})()
		return shutdownPromise
	}
	signals.on('SIGINT', onSignal)
	signals.on('SIGTERM', onSignal)
	try {
		store = createTelemetryStore(resources.runtime.telemetry)
		const observeConnection = () => {
			const connection = store!.getSnapshot().snapshot.connection
			if (connection.state === 'failed') {
				failedConnection = true
				state.update({
					failure: connection.failure,
					message: 'Connection failed'
				})
			}
		}
		disposeState = store.subscribe(observeConnection)
		observeConnection()
		session.mount(
			<App
				telemetry={store}
				application={state}
				displayClock={options.displayClock ?? defaultDisplayClock}
				statusClock={options.statusClock}
				onExit={() => {
					void shutdown()
				}}
				onFatal={() => {
					void shutdown('fatal')
				}}
				view={options.view}
			/>
		)
	} catch {
		void shutdown('fatal')
	}
	const ready = (async () => {
		try {
			await session.flush()
			if (!shutdownPromise && !failedConnection) resources.runtime.start()
			if (!shutdownPromise)
				state.update({
					phase: 'running',
					message: failedConnection ? 'Connection failed' : 'Runtime running'
				})
		} catch {
			void shutdown('fatal')
		}
	})()
	return Object.freeze({ ready, done, shutdown, flush: () => session.flush() })
}
