import EventEmitter from 'node:events'
import { createActor, type Actor, type AnyStateMachine } from 'xstate'
import type { Bot, Entity } from '@types'
import type { MachineContext } from '@hsm/context'
import type { MachineEvent } from '@hsm/types'

import { machine } from '@hsm/machine'
import { AntiLoopGuard } from '@hsm/utils/antiLoop'
import { cleanupPathfindCache } from '@utils/combat/enemyVisibility'

class BotStateMachine extends EventEmitter {
	private bot: Bot
	private readonly machine: AnyStateMachine = machine
	private actor!: Actor<typeof machine>
	private antiLoopGuard: AntiLoopGuard
	private pathfindCacheCleanupInterval?: NodeJS.Timeout

	constructor(bot: Bot) {
		super()
		this.bot = bot

		this.antiLoopGuard = new AntiLoopGuard({
			maxTransitionsPerSecond: 20,
			emergencyStopAfter: 100,
			windowMs: 1000
		})

		this.init()
	}

	async init(): Promise<void> {
		await this.bot.memory.load()

		this.actor = createActor(this.machine, {
			input: {
				bot: this.bot
			}
		})

		console.log('HSM машина создана')

		this.bot.hsm = this

		// this.setupAntiLoopObserver()
		this.setupBotEvents()
		this.handlers()

		this.actor.start()

		console.log('HSM актор запущен')
		console.log('Активные состояния', this.actor.getSnapshot().value)

		// Периодическая очистка кеша pathfinder
		this.pathfindCacheCleanupInterval = setInterval(() => {
			cleanupPathfindCache(10000) // Удалять записи старше 10 секунд
		}, 15000) // Каждые 15 секунд

		console.log(
			'✅ [Кеш pathfinder] Периодическая очистка включена (каждые 10с)'
		)
	}

	setupAntiLoopObserver(): void {
		this.actor.subscribe(() => {
			// Просто записываем факт обновления машины состояний
			const isAllowed = this.antiLoopGuard.recordUpdate()

			if (!isAllowed) {
				console.error('')
				console.error('🚨 Остановка бота из-за зацикливания!')
				console.error('Статистика:', this.antiLoopGuard.getStats())
				console.error('')

				this.actor.stop()

				if (this.bot && this.bot.chat) {
					this.bot.chat('⚠️ Произошла критическая ошибка! Остановка...')
				}

				setTimeout(() => {
					process.exit(1)
				}, 1000)
			}
		})
	}

	getStateString(stateValue: unknown): string {
		if (typeof stateValue === 'string') {
			return stateValue
		}

		if (typeof stateValue === 'object' && stateValue !== null) {
			return JSON.stringify(stateValue)
		}

		return String(stateValue)
	}

	/**
	 * Извлекает листовые (конечные) состояния из иерархии для AntiLoopGuard
	 * Например: {"MAIN_ACTIVITY": {"COMBAT": "MELEE_ATTACKING"}} → "MELEE_ATTACKING"
	 */
	extractLeafStates(stateValue: unknown): string[] {
		const states: string[] = []

		const traverse = (value: unknown): void => {
			if (typeof value === 'string') {
				states.push(value)
			} else if (typeof value === 'object' && value !== null) {
				Object.values(value).forEach(traverse)
			}
		}

		traverse(stateValue)
		return states
	}

	/**
	 * Возвращает простое представление состояния для AntiLoopGuard
	 * Приоритетно берёт состояние из MAIN_ACTIVITY, иначе первое доступное
	 */
	getSimpleStateName(stateValue: unknown): string {
		// Для параллельных машин xstate
		if (typeof stateValue === 'object' && stateValue !== null) {
			const stateObj = stateValue as Record<string, any>

			// Приоритетно ищем MAIN_ACTIVITY
			if (stateObj.MAIN_ACTIVITY) {
				const mainActivityStates = this.extractLeafStates(
					stateObj.MAIN_ACTIVITY
				)
				if (mainActivityStates.length > 0) {
					// Возвращаем самое глубокое состояние в MAIN_ACTIVITY
					return mainActivityStates[mainActivityStates.length - 1] || 'UNKNOWN'
				}
			}
		}

		// Фоллбэк: берём первое листовое состояние
		const leafStates = this.extractLeafStates(stateValue)
		return leafStates[0] || 'UNKNOWN'
	}

	getContext(): MachineContext {
		return this.actor.getSnapshot().context as MachineContext
	}

	getCurrentState(): unknown {
		return this.actor.getSnapshot().value
	}

	getCurrentStateString(): string {
		// Защита: если actor еще не инициализирован
		if (!this.actor) {
			// console.warn('⚠️ getCurrentStateString: actor еще не создан')
			return 'IDLE'
		}

		const snapshot = this.actor.getSnapshot()
		if (!snapshot) {
			// console.warn('⚠️ getCurrentStateString: snapshot undefined')
			return 'IDLE'
		}

		return this.getStateString(snapshot.value)
	}

	getCurrentStateValue(): unknown {
		// Защита: если actor еще не инициализирован
		if (!this.actor) {
			return 'IDLE'
		}

		const snapshot = this.actor.getSnapshot()
		if (!snapshot) {
			return 'IDLE'
		}

		return snapshot.value
	}

	isInState(statePath: string | Record<string, unknown>): boolean {
		return this.actor.getSnapshot().matches(statePath as any)
	}

	handlers(): void {
		this.on(
			'player-command',
			(
				commandName: string,
				{ username, options }: { username: string; options?: string[] }
			) => {
				if (commandName === 'stop') {
				} else {
					// this.actor.send({
					// 	type: 'START_MINING',
					// 	taskData: {
					// 		blockName: options?.[0] || 'stone',
					// 		navigationAttempts: 0,
					// 		count: +options?.[1]! || 3
					// 	}
					// })
					this.actor.send({
						type: 'START_FOLLOWING',
						taskData: {
							entityName: 'Smidvard',
							searchAttempts: 0,
							maxSearchAttempts: 5
						}
					})
				}
			}
		)
	}

	setupBotEvents(): void {
		this.bot.on('health', () => {
			const context = this.getContext()

			if (context.health !== this.bot.health) {
				console.log('Здоровье:', this.bot.health.toFixed(1))
			}

			if (context.food !== this.bot.food) {
				console.log('Голод:', this.bot.food)
			}

			this.actor.send({
				type: 'UPDATE_HEALTH',
				health: this.bot.health
			})

			this.actor.send({
				type: 'UPDATE_FOOD',
				food: this.bot.food
			})

			this.actor.send({
				type: 'UPDATE_SATURATION',
				foodSaturation: this.bot.foodSaturation
			})
		})

		this.bot.on('breath', () => {
			this.actor.send({
				type: 'UPDATE_OXYGEN',
				oxygenLevel: this.bot.oxygenLevel
			})
		})

		this.bot.on('move', () => {
			this.actor.send({
				type: 'UPDATE_POSITION',
				position: this.bot.entity.position
			})
		})

		this.bot.on('death', () => {
			this.actor.send({ type: 'DEATH' })
		})

		this.bot.on('entityDead', (entity: Entity) => {
			this.actor.send({
				type: 'REMOVE_ENTITY',
				entity
			})
		})

		this.bot.on('itemDrop', (entity: Entity) => {
			if (entity.name === 'broken_item') {
				this.actor.send({ type: 'WEAPON_BROKEN' })
			}
		})
	}

	/**
	 * Остановка всех сервисов при завершении работы
	 */
	stop(): void {
		if (this.pathfindCacheCleanupInterval) {
			clearInterval(this.pathfindCacheCleanupInterval)
		}

		if (this.actor) {
			this.actor.stop()
		}

		console.log('❌ [HSM] Остановлен')
	}
}

export default BotStateMachine
