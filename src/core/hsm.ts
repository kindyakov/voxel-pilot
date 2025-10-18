import EventEmitter from 'node:events'
import { createActor, type Actor, type AnyStateMachine } from 'xstate'
import type { Bot, Entity } from '@types'
import type { MachineContext } from '@hsm/context'
import type { MachineEvent } from '@hsm/types'

import { machine } from '@hsm/machine'
import { AntiLoopGuard } from '@hsm/utils/antiLoop'

class BotStateMachine extends EventEmitter {
	private bot: Bot
	private readonly machine: AnyStateMachine = machine
	private actor!: Actor<typeof machine>
	private antiLoopGuard: AntiLoopGuard

	constructor(bot: Bot) {
		super()
		this.bot = bot

		this.antiLoopGuard = new AntiLoopGuard({
			maxTransitionsPerSecond: 15,
			emergencyStopAfter: 100,
			windowMs: 1000
		})

		this.init()
	}

	init(): void {
		this.actor = createActor(this.machine)

		console.log('HSM машина создана')

		this.bot.hsm = this

		this.setupAntiLoopObserver()
		this.setupBotEvents()
		this.handlers()

		this.actor.start()

		this.actor.send({
			type: 'SET_BOT',
			bot: this.bot
		})

		console.log('HSM актор запущен')
		console.log('Активные состояния', this.actor.getSnapshot().value)
	}

	setupAntiLoopObserver(): void {
		let lastState: string | null = null
		let lastTransitionTime = Date.now()
		let rapidTransitionCount = 0

		this.actor.subscribe(snapshot => {
			const currentState = this.getStateString(snapshot.value)
			const now = Date.now()

			if (lastState && lastState !== currentState) {
				const timeSinceLastTransition = now - lastTransitionTime

				const isAllowed = this.antiLoopGuard.recordTransition(
					lastState,
					currentState
				)

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

					return
				}

				if (timeSinceLastTransition < 50) {
					rapidTransitionCount++

					if (rapidTransitionCount > 20) {
						console.error(
							`🚨 CRITICAL: ${rapidTransitionCount} rapid transitions (< 50ms)`
						)
						console.error(`${lastState} → ${currentState}`)
					}
				} else {
					rapidTransitionCount = 0
				}

				lastTransitionTime = now
			}

			lastState = currentState
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

	getContext(): MachineContext {
		return this.actor.getSnapshot().context as MachineContext
	}

	getCurrentState(): unknown {
		return this.actor.getSnapshot().value
	}

	getCurrentStateString(): string {
		return this.getStateString(this.actor.getSnapshot().value)
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
					this.actor.send({
						type: 'START_MINING',
						taskData: {
							blockName: options?.[0] || 'stone',
							navigationAttempts: 0,
							count: 3
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
}

export default BotStateMachine
