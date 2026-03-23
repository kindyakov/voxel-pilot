import { createActor } from 'xstate'

import type { Bot, Entity } from '@types'

import type { MachineContext } from '@hsm/context'
import { machine } from '@hsm/machine'
import type { MachineEvent } from '@hsm/types'
import { AntiLoopGuard } from '@hsm/utils/antiLoop'

import { cleanupPathfindCache } from '@utils/combat/enemyVisibility'

class BotStateMachine {
	private bot: Bot
	private actor: any = null
	private readonly antiLoopGuard: AntiLoopGuard
	private pathfindCacheCleanupInterval?: NodeJS.Timeout
	private readonly pendingEvents: MachineEvent[] = []
	private isReady = false

	constructor(bot: Bot) {
		this.bot = bot
		this.antiLoopGuard = new AntiLoopGuard({
			maxTransitionsPerSecond: 20,
			emergencyStopAfter: 100,
			windowMs: 1000
		})

		void this.init()
	}

	private async init(): Promise<void> {
		await this.bot.memory.load()

		this.actor = createActor(machine, {
			input: {
				bot: this.bot
			}
		})

		this.bot.hsm = this
		this.setupBotEvents()
		this.actor.start()
		this.isReady = true
		this.flushPendingEvents()
		this.setupAntiLoopObserver()

		this.pathfindCacheCleanupInterval = setInterval(() => {
			cleanupPathfindCache(10000)
		}, 15000)
	}

	send(event: MachineEvent): void {
		if (!this.actor || !this.isReady) {
			this.pendingEvents.push(event)
			return
		}

		this.actor.send(event)
	}

	private flushPendingEvents(): void {
		while (this.pendingEvents.length > 0) {
			const event = this.pendingEvents.shift()
			if (event) {
				this.actor.send(event)
			}
		}
	}

	private setupAntiLoopObserver(): void {
		this.actor.subscribe((snapshot: any) => {
			const signature = JSON.stringify(snapshot?.value ?? 'unknown')
			const isAllowed = this.antiLoopGuard.recordUpdate(signature)

			if (!isAllowed) {
				this.actor.stop()
				this.bot.chat('⚠️ Произошла критическая ошибка! Остановка...')
				setTimeout(() => {
					process.exit(1)
				}, 1000)
			}
		})
	}

	getContext(): MachineContext {
		return this.actor.getSnapshot().context as MachineContext
	}

	getCurrentState(): unknown {
		return this.actor.getSnapshot().value
	}

	getCurrentStateString(): string {
		const snapshot = this.actor?.getSnapshot()
		return snapshot ? JSON.stringify(snapshot.value) : 'IDLE'
	}

	getCurrentStateValue(): unknown {
		const snapshot = this.actor?.getSnapshot()
		return snapshot ? snapshot.value : 'IDLE'
	}

	isInState(statePath: string | Record<string, unknown>): boolean {
		return this.actor.getSnapshot().matches(statePath as never)
	}

	private setupBotEvents(): void {
		this.bot.on('health', () => {
			this.send({
				type: 'UPDATE_HEALTH',
				health: this.bot.health
			})

			this.send({
				type: 'UPDATE_FOOD',
				food: this.bot.food
			})

			this.send({
				type: 'UPDATE_SATURATION',
				foodSaturation: this.bot.foodSaturation
			})
		})

		this.bot.on('breath', () => {
			this.send({
				type: 'UPDATE_OXYGEN',
				oxygenLevel: this.bot.oxygenLevel
			})
		})

		this.bot.on('move', () => {
			this.send({
				type: 'UPDATE_POSITION',
				position: this.bot.entity.position
			})
		})

		this.bot.on('death', () => {
			this.send({ type: 'DEATH' })
		})

		this.bot.on('entityDead', (entity: Entity) => {
			this.send({
				type: 'REMOVE_ENTITY',
				entity
			})
		})

		this.bot.on('itemDrop', (entity: Entity) => {
			if (entity.name === 'broken_item') {
				this.send({ type: 'WEAPON_BROKEN' })
			}
		})
	}

	stop(): void {
		if (this.pathfindCacheCleanupInterval) {
			clearInterval(this.pathfindCacheCleanupInterval)
		}

		if (this.actor) {
			this.actor.stop()
		}

		this.bot.memory.close()
	}
}

export default BotStateMachine
