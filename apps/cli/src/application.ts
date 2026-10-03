import type {
	BotRuntime,
	RuntimeProblem,
	StopResult
} from '@voxel-pilot/contracts'
import type { RuntimeLoggerHandle } from '@voxel-pilot/core/services'

interface Signals {
	on(signal: 'SIGINT' | 'SIGTERM', listener: () => void): unknown
	off(signal: 'SIGINT' | 'SIGTERM', listener: () => void): unknown
}

export interface ApplicationOptions {
	readonly runtime: BotRuntime
	readonly loggerHandle: RuntimeLoggerHandle
	readonly signals: Signals
	readonly exit: (code: number) => void
	readonly report: (message: string) => void
	readonly shutdownTimeoutMs?: number
}

export interface ApplicationStopResult {
	readonly exitCode: number
	readonly runtime: StopResult | null
	readonly issues: readonly RuntimeProblem[]
}

/** One app-owned deadline covers runtime finalization and caller-owned logger close. */
export function startCliApplication(options: ApplicationOptions) {
	const timeout = options.shutdownTimeoutMs ?? 15_000
	if (
		!Number.isSafeInteger(timeout) ||
		timeout <= 0 ||
		timeout > 2_147_483_647
	) {
		throw new Error('shutdownTimeoutMs must be positive and finite')
	}
	let shutdownPromise: Promise<ApplicationStopResult> | null = null
	let failed = false
	let unsubscribe = () => {}
	const reportMessage = (message: string) => {
		try {
			void Promise.resolve(options.report(message)).catch(() => {})
		} catch {}
	}
	const shutdown = (): Promise<ApplicationStopResult> => {
		if (shutdownPromise) return shutdownPromise
		let resolve!: (result: ApplicationStopResult) => void
		shutdownPromise = new Promise(done => {
			resolve = done
		})
		const issues: RuntimeProblem[] = []
		let result: StopResult | null = null
		let finished = false
		const finish = () => {
			if (finished) return
			finished = true
			clearTimeout(timer)
			unsubscribe()
			options.signals.off('SIGINT', onSignal)
			options.signals.off('SIGTERM', onSignal)
			const exitCode =
				failed || issues.length || (result && result.outcome !== 'stopped')
					? 1
					: 0
			const report = Object.freeze({
				exitCode,
				runtime: result,
				issues: Object.freeze([...issues])
			})
			resolve(report)
			options.exit(exitCode)
		}
		const timer = setTimeout(() => {
			issues.push(
				Object.freeze({
					code: 'application-shutdown-deadline',
					message:
						'Application shutdown deadline exceeded; persistence and resource cleanup may be incomplete.'
				})
			)
			reportMessage(issues.at(-1)!.message)
			finish()
		}, timeout)
		options.loggerHandle.logger.info('Остановка бота...')
		void (async () => {
			try {
				result = await options.runtime.stop('Выключение сервера')
				for (const issue of result.issues) reportMessage(issue.message)
			} catch {
				issues.push(
					Object.freeze({
						code: 'runtime-stop-failed',
						message: 'Runtime shutdown failed; persistence may be incomplete.'
					})
				)
				reportMessage(issues.at(-1)!.message)
			} finally {
				try {
					await options.loggerHandle.close()
				} catch {
					issues.push(
						Object.freeze({
							code: 'logger-close-failed',
							message:
								'Application log output could not be closed successfully.'
						})
					)
					reportMessage(issues.at(-1)!.message)
				}
			}
			finish()
		})()
		return shutdownPromise
	}
	const onSignal = () => {
		void shutdown()
	}
	options.signals.on('SIGINT', onSignal)
	options.signals.on('SIGTERM', onSignal)
	unsubscribe = options.runtime.telemetry.subscribe(snapshot => {
		if (snapshot.connection.state === 'failed') {
			failed = true
			if (snapshot.connection.failure)
				reportMessage(snapshot.connection.failure.message)
			void shutdown()
		}
	})
	if (!shutdownPromise) options.runtime.start()
	return Object.freeze({ shutdown })
}
