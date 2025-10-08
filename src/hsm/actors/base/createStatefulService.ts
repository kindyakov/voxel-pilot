import { fromCallback } from 'xstate'
import type { Bot } from '@types'
import type { MachineEvent } from '@hsm/types'
import type { MachineContext } from '@hsm/context'

export type BaseServiceState = {
	isActive: boolean
	[key: string]: unknown
}

type ServiceState = BaseServiceState

interface ServiceAPI<TState extends ServiceState> {
	bot: Bot
	context: MachineContext
	state: TState
	event?: unknown
	sendBack: (event: MachineEvent) => void
	setState: (newState: Partial<TState>) => void
	getContext: () => MachineContext
	abortSignal: AbortSignal
}

type ServiceHandler<TState extends ServiceState> = (
	api: ServiceAPI<TState>
) => void | Promise<void>

type ServiceEventsHandler<TState extends ServiceState> = (
	api: ServiceAPI<TState>
) => Record<string, (...args: any[]) => void>

interface StatefulServiceConfig<TState extends ServiceState> {
	name: string
	tickInterval?: number
	initialState?: Partial<TState>
	asyncTickInterval?: number
	onStart?: ServiceHandler<TState>
	onTick?: ServiceHandler<TState>
	onAsyncTick?: ServiceHandler<TState>
	onEvents?: ServiceEventsHandler<TState>
	onCleanup?: ServiceHandler<TState>
	onReceive?: ServiceHandler<TState>
}

/**
 * Универсальный factory для создания stateful service
 * Поддерживает: sync, async, events, гибридный подход
 */
export function createStatefulService<
	TState extends ServiceState = ServiceState
>(config: StatefulServiceConfig<TState>) {
	return fromCallback<MachineEvent, { context: MachineContext }>(
		({ sendBack, input, receive }) => {
			const { context } = input
			const { bot } = context

			if (!bot) {
				throw new Error(`[${config.name}] Bot is null in service context`)
			}

			// Внутреннее состояние service
			let internalState: TState = {
				...config.initialState,
				isActive: true
			} as TState

			// AbortController для отмены async операций
			const abortController = new AbortController()

			// Helper для обновления состояния
			const setState = (updates: Partial<TState>) => {
				internalState = { ...internalState, ...updates }
			}

			// Helper для получения актуального контекста
			const getContext = () => bot.hsm.getContext()

			// API для callbacks
			const api: ServiceAPI<TState> = {
				context: getContext(),
				state: internalState,
				bot,
				sendBack,
				setState,
				getContext,
				abortSignal: abortController.signal
			}

			// ========================================
			// 1. Инициализация (если задана)
			// ========================================
			if (config.onStart) {
				try {
					api.context = getContext()
					config.onStart(api)
				} catch (error) {
					console.error(`❌ Error in ${config.name} onStart:`, error)
				}
			}

			// ========================================
			// 2. Синхронный tick (если задан)
			// ========================================
			let tickInterval: NodeJS.Timeout | null = null

			if (config.onTick) {
				const tick = () => {
					if (!internalState.isActive) return

					try {
						// Обновляем api с актуальным контекстом
						api.context = getContext()
						api.state = internalState

						config.onTick!(api)
					} catch (error) {
						console.error(`❌ Error in ${config.name} onTick:`, error)
						sendBack({
							type: 'ERROR',
							error: error instanceof Error ? error.message : String(error)
						})
					}
				}

				tickInterval = setInterval(tick, config.tickInterval || 1000)
			}

			// ========================================
			// 3. Асинхронный tick (если задан)
			// ========================================
			let asyncTickInterval: NodeJS.Timeout | null = null
			let isAsyncRunning = false

			if (config.onAsyncTick) {
				const asyncTick = async () => {
					if (!internalState.isActive || isAsyncRunning) return

					isAsyncRunning = true

					try {
						api.context = getContext()
						api.state = internalState

						await config.onAsyncTick!(api)
					} catch (error) {
						if (error instanceof Error) {
							if (error.name === 'AbortError') {
								console.log(`⚠️ ${config.name}: async операция отменена`)
								return
							}

							console.error(
								`❌ Error in ${config.name} onAsyncTick:`,
								error.message
							)
							sendBack({ type: 'ERROR', error: error.message })
						} else {
							const errorMessage = String(error)
							console.error(
								`❌ Error in ${config.name} onAsyncTick:`,
								errorMessage
							)
							sendBack({ type: 'ERROR', error: errorMessage })
						}
					} finally {
						isAsyncRunning = false
					}
				}

				asyncTickInterval = setInterval(
					asyncTick,
					config.asyncTickInterval || 2000
				)
			}

			// ========================================
			// 4. Подписка на события bot (если заданы)
			// ========================================
			const eventHandlers = new Map<string, (...args: any[]) => void>()

			if (config.onEvents) {
				const events = config.onEvents(api)

				for (const [eventName, handler] of Object.entries(events)) {
					const wrappedHandler = (...args: any[]) => {
						if (!internalState.isActive) return

						try {
							api.context = getContext()
							api.state = internalState

							handler(api, ...args)
						} catch (error) {
							console.error(
								`❌ Error in ${config.name} event ${eventName}:`,
								error
							)
						}
					}

					bot.on(eventName as any, wrappedHandler)
					eventHandlers.set(eventName, wrappedHandler)
				}
			}

			// ========================================
			// 5. Получение событий от машины (если задано)
			// ========================================
			if (config.onReceive) {
				receive(event => {
					if (!internalState.isActive) return

					try {
						api.context = getContext()
						api.state = internalState
						api.event = event

						config.onReceive!(api)
					} catch (error) {
						console.error(`❌ Error in ${config.name} onReceive:`, error)
					}
				})
			}

			// ========================================
			// CLEANUP
			// ========================================
			return () => {
				internalState.isActive = false

				// Отменяем все async операции
				abortController.abort()

				// Очищаем интервалы
				if (tickInterval) clearInterval(tickInterval)
				if (asyncTickInterval) clearInterval(asyncTickInterval)

				// Отписываемся от событий
				for (const [eventName, handler] of eventHandlers) {
					bot.off(eventName as any, handler)
				}

				// Пользовательский cleanup
				if (config.onCleanup) {
					try {
						config.onCleanup({
							bot,
							context: getContext(),
							state: internalState,
							sendBack,
							setState,
							getContext,
							abortSignal: abortController.signal
						})
					} catch (error) {
						console.error(`❌ Error in ${config.name} onCleanup:`, error)
					}
				}
			}
		}
	)
}
