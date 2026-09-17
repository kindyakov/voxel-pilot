import { fromCallback } from 'xstate'

import type { Bot } from '@/types/index.js'

import Logger from '@/config/logger.js'

import type { MachineContext } from '@/hsm/context.js'
import type { MachineEvent } from '@/hsm/types.js'

export type BaseServiceState = {
	isActive: boolean
	[key: string]: unknown
}

export interface ServiceAPI<TState extends BaseServiceState, TOptions = {}> {
	bot: Bot
	readonly context: MachineContext
	readonly state: TState
	input: TOptions
	event?: unknown
	sendBack: (event: MachineEvent) => void
	setState: (newState: Partial<TState>) => void
	getContext: () => MachineContext
	abortSignal: AbortSignal
}

type ServiceHandler<TState extends BaseServiceState, TOptions = {}> = (
	api: ServiceAPI<TState, TOptions>
) => void | Promise<void>

interface StatefulServiceConfig<
	TState extends BaseServiceState,
	TOptions = {}
> {
	name: string
	tickInterval?: number
	asyncTickInterval?: number
	timeoutMs?: number
	operationTimeoutMs?: number
	errorEvent?: (error: string) => MachineEvent
	initialState?: Partial<TState>
	onStart?: ServiceHandler<TState, TOptions>
	onTick?: ServiceHandler<TState, TOptions>
	onAsyncTick?: ServiceHandler<TState, TOptions>
	onEvents?: (
		api: ServiceAPI<TState, TOptions>
	) => Record<
		string,
		(api: ServiceAPI<TState, TOptions>, ...args: any[]) => void | Promise<void>
	>
	onCleanup?: ServiceHandler<TState, TOptions>
	onReceive?: ServiceHandler<TState, TOptions>
}

/** Owns subscriptions, deadlines, error delivery and cancellation for one invocation. */
export function createStatefulService<
	TState extends BaseServiceState = BaseServiceState,
	TOptions = {}
>(config: StatefulServiceConfig<TState, TOptions>) {
	return fromCallback<MachineEvent, { bot: Bot; options: TOptions }>(
		({ sendBack, input, receive }) => {
			const { bot, options } = input
			const abortController = new AbortController()
			let state = { ...config.initialState, isActive: true } as TState
			let ready = false
			let failed = false
			let stopped = false
			const timers: ReturnType<typeof setInterval>[] = []
			const operationTimers = new Set<ReturnType<typeof setTimeout>>()
			const subscriptions = new Map<string, (...args: any[]) => void>()
			const getContext = () => bot.hsm.getContext()
			const reportError = (error: unknown) => {
				if (stopped || failed || abortController.signal.aborted) return
				failed = true
				abortController.abort()
				const message = error instanceof Error ? error.message : String(error)
				Logger.error(`[${config.name}] service failed`, { error: message })
				sendBack(
					config.errorEvent?.(message) ?? { type: 'ERROR', error: message }
				)
			}
			const api: ServiceAPI<TState, TOptions> = {
				bot,
				get context() {
					return getContext()
				},
				get state() {
					return state
				},
				input: options,
				sendBack: event => {
					if (!stopped && !failed && !abortController.signal.aborted)
						sendBack(event)
				},
				setState: updates => {
					state = { ...state, ...updates }
				},
				getContext,
				abortSignal: abortController.signal
			}
			const run = (handler: () => void | Promise<void>) => {
				try {
					const result = handler()
					if (!(result instanceof Promise)) return Promise.resolve()
					if (stopped || failed) return result.catch(reportError)
					const timer =
						config.operationTimeoutMs === undefined
							? undefined
							: setTimeout(
									() =>
										reportError(
											new Error(`${config.name} operation timed out`)
										),
									config.operationTimeoutMs
								)
					if (timer) operationTimers.add(timer)
					return result.catch(reportError).finally(() => {
						if (timer) {
							clearTimeout(timer)
							operationTimers.delete(timer)
						}
					})
				} catch (error) {
					reportError(error)
					return Promise.resolve()
				}
			}
			try {
				// Subscribe before startup: setGoal/open may emit their result synchronously.
				for (const [name, handler] of Object.entries(
					config.onEvents?.(api) ?? {}
				)) {
					const listener = (...args: any[]) => {
						if (!stopped && !failed) void run(() => handler(api, ...args))
					}
					bot.on(name as any, listener)
					subscriptions.set(name, listener)
				}
				receive(event => {
					if (stopped || failed || !config.onReceive) return
					api.event = event
					void run(() => config.onReceive!(api))
				})
				const schedule = (
					handler: ServiceHandler<TState, TOptions> | undefined,
					interval: number
				) => {
					if (!handler) return
					let running = false
					timers.push(
						setInterval(() => {
							if (!ready || stopped || failed || running) return
							running = true
							void run(() => handler(api)).finally(() => {
								running = false
							})
						}, interval)
					)
				}
				schedule(config.onTick, config.tickInterval ?? 1000)
				schedule(config.onAsyncTick, config.asyncTickInterval ?? 2000)
				if (config.timeoutMs !== undefined) {
					timers.push(
						setTimeout(
							() => reportError(new Error(`${config.name} timed out`)),
							config.timeoutMs
						)
					)
				}
				void run(() => config.onStart?.(api)).then(() => {
					ready = !failed && !stopped
				})
			} catch (error) {
				reportError(error)
			}
			return () => {
				stopped = true
				state.isActive = false
				abortController.abort()
				for (const timer of timers) clearInterval(timer)
				for (const timer of operationTimers) clearTimeout(timer)
				operationTimers.clear()
				for (const [name, handler] of subscriptions)
					bot.off(name as any, handler)
				try {
					const result = config.onCleanup?.(api)
					if (result instanceof Promise)
						void result.catch(error =>
							Logger.error(`[${config.name}] cleanup failed`, {
								error: String(error)
							})
						)
				} catch (error) {
					Logger.error(`[${config.name}] cleanup failed`, {
						error: String(error)
					})
				}
			}
		}
	)
}
