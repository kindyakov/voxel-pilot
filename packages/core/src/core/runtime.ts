import type {
	BotRuntime,
	BotSnapshot,
	ConnectionSnapshot,
	StopResult
} from '@voxel-pilot/contracts'

import type { RuntimeServices } from '@/config/runtimeServices.js'

import type { NativeInspectionOptions } from '@/hsm/inspection/index.js'

import MinecraftBot, { type ConnectionDependencies } from './bot.js'
import { stopIssue } from './finalization.js'
import {
	type LogHistoryOptions,
	createLogJournal
} from './telemetry/logJournal.js'

export interface BotRuntimeOptions {
	readonly stopTimeoutMs?: number
	readonly connection?: Partial<ConnectionDependencies>
	readonly inspection?: NativeInspectionOptions
	readonly logs?: LogHistoryOptions
}

const unknown = Object.freeze({ value: null, updatedAt: null, stale: false })

/** Delivers observations without lending subscribers lifecycle authority. */
function deliver(
	listener: (snapshot: BotSnapshot) => void,
	value: BotSnapshot
) {
	try {
		// A void callback may still be async; absorb its rejection too.
		void Promise.resolve(listener(value)).catch(() => {})
	} catch {
		// Observer failures never change the bot lifecycle.
	}
}

/** Creates an inert native owner behind a frozen, portable application facade. */
export function createBotRuntime(
	services: RuntimeServices,
	options: BotRuntimeOptions = {}
): BotRuntime {
	const timeout = options.stopTimeoutMs ?? 10_000
	if (
		!Number.isSafeInteger(timeout) ||
		timeout <= 0 ||
		timeout > 2_147_483_647
	) {
		throw new Error('stopTimeoutMs must be positive and finite')
	}
	const journal = createLogJournal(services.config.ai, options.logs)
	let disposeLogs: (() => void) | undefined
	const attachLogs = () => {
		if (disposeLogs) return
		journal.resume()
		disposeLogs = services.logger.subscribeRecords(
			journal.append,
			journal.level
		)
	}
	const owner = new MinecraftBot(services, options.connection, {
		inspection: options.inspection
	})
	attachLogs()
	const listeners = new Set<{ listener: (snapshot: BotSnapshot) => void }>()
	let snapshot: BotSnapshot
	let stopping = false
	let stopPromise: Promise<StopResult> | null = null
	const observe = (connection: ConnectionSnapshot) => {
		snapshot = Object.freeze({
			revision: snapshot ? snapshot.revision + 1 : 0,
			connection,
			health: unknown,
			maxHealth: unknown,
			food: unknown,
			position: unknown,
			harness: unknown
		})
		const current = snapshot
		for (const subscription of [...listeners]) {
			// Stop/start inside a callback may already have published a newer revision.
			if (snapshot !== current) break
			if (listeners.has(subscription)) deliver(subscription.listener, current)
		}
	}
	owner.subscribeConnection(observe)
	const telemetry = Object.freeze({
		getSnapshot: () => snapshot,
		getLogHistory: journal.getHistory,
		subscribeLogs: journal.subscribe,
		subscribe(listener: (snapshot: BotSnapshot) => void) {
			const subscription = { listener }
			listeners.add(subscription)
			deliver(listener, snapshot)
			return () => {
				listeners.delete(subscription)
			}
		}
	})
	return Object.freeze({
		telemetry,
		start() {
			if (stopping) return
			if (['idle', 'stopped', 'failed'].includes(snapshot.connection.state)) {
				stopPromise = null
				attachLogs()
			}
			owner.start()
		},
		stop(reason?: string) {
			if (stopPromise) return stopPromise
			stopping = true
			let resolve!: (result: StopResult) => void
			stopPromise = new Promise(done => {
				resolve = done
			})
			const stoppingPromise = stopPromise
			let settled = false
			let timer: ReturnType<typeof setTimeout>
			const finish = (result: StopResult) => {
				if (settled) return
				settled = true
				clearTimeout(timer)
				const frozen = Object.freeze({
					...result,
					issues: Object.freeze([...result.issues])
				})
				owner.completeStop(frozen)
				disposeLogs?.()
				disposeLogs = undefined
				journal.detach()
				stopping = false
				resolve(frozen)
			}
			timer = setTimeout(
				() =>
					finish({
						outcome: 'timed-out',
						persistence: 'incomplete',
						issues: [
							...owner.getFinalizationIssues(),
							stopIssue(
								'deadline',
								'stop-deadline-exceeded',
								'Runtime shutdown deadline exceeded; persistence and resource cleanup may be incomplete.'
							)
						]
					}),
				timeout
			)
			owner.stop(reason)
			void owner.finalize().then(
				report =>
					finish({
						outcome: report.issues.length ? 'failed' : 'stopped',
						persistence: report.persistence,
						issues: report.issues
					}),
				() =>
					finish({
						outcome: 'failed',
						persistence: 'incomplete',
						issues: [
							stopIssue(
								'cleanup',
								'finalization-failed',
								'Runtime finalization failed; persistence and resource cleanup may be incomplete.'
							)
						]
					})
			)
			return stoppingPromise
		}
	})
}
