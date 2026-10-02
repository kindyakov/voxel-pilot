import type { Bot, Entity } from '@/types/index.js'
import type { HarnessSummary, StopIssue } from '@voxel-pilot/contracts'
import type { BotEvents } from 'mineflayer'
import { type ActorRefFrom, createActor } from 'xstate'

import type { MachineContext } from '@/hsm/context.js'
import type { HarnessDependencies } from '@/hsm/dependencies.js'
import { createBotMachine } from '@/hsm/machine.js'
import type { MachineEvent } from '@/hsm/types.js'
import { AntiLoopGuard } from '@/hsm/utils/antiLoop.js'
import { attachHsmDiagnostics } from '@/hsm/utils/runtimeDiagnostics.js'

import {
	cleanupPathfindCache,
	clearPathfindCache
} from '@/utils/combat/enemyVisibility.js'

import {
	type FinalizationReport,
	freezeReport,
	stopIssue
} from './finalization.js'
import { deliver } from './telemetry/facts.js'
import { createHarnessProjection } from './telemetry/harnessFacts.js'

interface StoreLifecycle {
	started: boolean
	loading: boolean
	closed: boolean
}

export interface BotStateMachineOptions {
	pausedGoal?: string | null
}

export class BotStateMachine {
	private readonly dependencies: HarnessDependencies
	private readonly bot: Bot
	private readonly memory: Bot['memory']
	private readonly profileMemory: Bot['profileMemory']
	private actor: ActorRefFrom<ReturnType<typeof createBotMachine>> | null = null
	private readonly antiLoopGuard: AntiLoopGuard
	private pathfindCacheCleanupInterval?: NodeJS.Timeout
	private readonly pendingEvents: MachineEvent[] = []
	private isReady = false
	private antiLoopTripped = false
	private antiLoopCooldown?: NodeJS.Timeout
	private stopDiagnostics?: () => void
	private readonly subscriptions: Array<() => void> = []
	private readonly factObservers = new Set<(summary: HarnessSummary) => void>()
	private summary: HarnessSummary | null = null
	private stopped = false
	private stopPromise: Promise<void> | null = null
	private saving: Promise<void> | null = null
	private saveFailed = false
	private readonly initialization: Promise<boolean>
	private finalization: Promise<FinalizationReport> | null = null
	private readonly issues: StopIssue[] = []
	private persistence: FinalizationReport['persistence'] = 'not-required'
	private cancelReady!: (ready: false) => void
	private readonly memoryLifecycle: StoreLifecycle = {
		started: false,
		loading: false,
		closed: false
	}
	private readonly profileLifecycle: StoreLifecycle = {
		started: false,
		loading: false,
		closed: false
	}
	readonly ready: Promise<boolean>

	constructor(
		bot: Bot,
		dependencies: HarnessDependencies,
		options: BotStateMachineOptions = {}
	) {
		this.dependencies = Object.freeze({ ...dependencies })
		this.bot = bot
		this.memory = bot.memory
		this.profileMemory = bot.profileMemory
		this.antiLoopGuard = new AntiLoopGuard(
			{
				maxTransitionsPerSecond: 20,
				emergencyStopAfter: 100,
				windowMs: 1000
			},
			this.dependencies.logger
		)

		const cancelled = new Promise<false>(resolve => {
			this.cancelReady = resolve
		})
		this.initialization = this.init(options.pausedGoal)
		this.ready = Promise.race([this.initialization, cancelled])
	}

	private async init(pausedGoal: string | null | undefined): Promise<boolean> {
		try {
			await this.loadStore(this.memory, this.memoryLifecycle)
			if (this.stopped) return false
			if (this.profileMemory) {
				await this.loadStore(this.profileMemory, this.profileLifecycle)
				if (this.stopped) return false
			}
			// Crash recovery (ADR-0004) is mandatory: rows left `active`
			// become `suspended` with progress kept, otherwise they can never
			// start again. No autostart — the pilot starts explicitly.
			// A recovery failure fails initialization like any store failure.
			const recovered = this.memory.normalizeTasksOnBoot()
			if (recovered > 0) {
				this.dependencies.logger.info('[HSM] recovered suspended tasks', {
					count: recovered
				})
			}
			if (this.stopped) return false
			// Construction reads current vitals; no stale pre-load health events are replayed.
			this.actor = createActor(createBotMachine(this.dependencies), {
				input: {
					bot: this.bot,
					pausedGoal,
					aiPilotEnabled: this.dependencies.aiPilotEnabled
				}
			})
			if (this.stopped) {
				this.releaseRuntime()
				return false
			}
			this.bot.hsm = this
			const project = createHarnessProjection()
			const facts = this.actor.subscribe(snapshot => {
				if (this.stopped) return
				const summary = project(snapshot.value, snapshot.context)
				if (this.summary === summary) return
				this.summary = summary
				for (const listener of [...this.factObservers]) {
					if (this.stopped || this.summary !== summary) break
					if (this.factObservers.has(listener)) deliver(listener, summary)
				}
			})
			this.subscriptions.push(() => facts.unsubscribe())
			if (this.dependencies.diagnosticsEnabled) {
				this.stopDiagnostics = attachHsmDiagnostics(
					this.actor,
					this.dependencies.logger,
					this.dependencies.minecraftVersion
				)
			}
			if (this.stopped) {
				this.releaseRuntime()
				return false
			}
			this.setupBotEvents()
			this.actor.start()
			if (this.stopped) return false
			this.isReady = true
			this.flushPendingEvents()
			if (this.stopped) return false
			this.setupAntiLoopObserver()
			this.pathfindCacheCleanupInterval = setInterval(() => {
				cleanupPathfindCache(this.bot, this.dependencies.logger, 10000)
			}, 15000)
			return true
		} catch (error) {
			this.issues.push(
				stopIssue(
					'cleanup',
					'harness-initialization-failed',
					'Harness initialization failed.'
				)
			)
			this.dependencies.logger.error('[HSM] initialization failed', {
				error: String(error)
			})
			this.stopped = true
			this.cancelReady(false)
			this.releaseRuntime()
			this.closeStores()
			return false
		}
	}

	private async loadStore(
		store: { load(): Promise<void>; close(): void },
		lifecycle: StoreLifecycle
	): Promise<void> {
		lifecycle.started = true
		lifecycle.loading = true
		try {
			await store.load()
		} finally {
			lifecycle.loading = false
			// A load cannot be interrupted, but its late result cannot reopen a live session.
			if (this.stopped) this.closeStore(store, lifecycle)
		}
	}

	send(event: MachineEvent): void {
		if (this.stopped) return
		if (!this.actor || !this.isReady) {
			this.pendingEvents.push(event)
			return
		}

		this.actor.send(event)
	}

	resumePausedGoal(): void {
		this.send({ type: 'RESUME_PAUSED_GOAL' })
	}

	private flushPendingEvents(): void {
		while (this.pendingEvents.length > 0) {
			const event = this.pendingEvents.shift()
			if (event) {
				this.actor?.send(event)
			}
		}
	}

	private setupAntiLoopObserver(): void {
		const subscription = this.actor!.subscribe(snapshot => {
			if (this.antiLoopTripped) {
				return
			}

			const signature = JSON.stringify(snapshot?.value ?? 'unknown')
			const isAllowed = this.antiLoopGuard.recordUpdate(signature)

			if (!isAllowed) {
				this.antiLoopTripped = true
				this.bot.chat('⚠️ Произошла критическая ошибка! Остановка...')
				this.send({ type: 'STOP_CURRENT_GOAL' })
				this.antiLoopCooldown = setTimeout(() => {
					this.antiLoopGuard.reset()
					this.antiLoopTripped = false
				}, 60_000)
			}
		})
		this.subscriptions.push(() => subscription.unsubscribe())
	}

	getContext(): MachineContext {
		if (!this.actor) throw new Error('HSM is not initialized')
		return this.actor.getSnapshot().context
	}

	/** Internal compact projection; the native owner redacts goal text before publication. */
	subscribeFacts(listener: (summary: HarnessSummary) => void): () => void {
		if (this.stopped) return () => {}
		this.factObservers.add(listener)
		if (this.summary) deliver(listener, this.summary)
		return () => {
			this.factObservers.delete(listener)
		}
	}

	getReconnectGoal(): string | null {
		const context = this.actor?.getSnapshot().context
		return context?.pausedGoal ?? context?.currentGoal ?? null
	}

	getCurrentState(): unknown {
		return this.actor?.getSnapshot().value ?? 'IDLE'
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
		return this.actor?.getSnapshot().matches(statePath as never) ?? false
	}

	private listen<TEvent extends keyof BotEvents>(
		event: TEvent,
		listener: BotEvents[TEvent]
	): void {
		this.bot.on(event, listener)
		this.subscriptions.push(() => this.bot.off(event, listener))
	}

	private setupBotEvents(): void {
		this.listen('health', () => {
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

		this.listen('breath', () => {
			this.send({
				type: 'UPDATE_OXYGEN',
				oxygenLevel: this.bot.oxygenLevel
			})
		})

		this.listen('move', () => {
			this.send({
				type: 'UPDATE_POSITION',
				position: this.bot.entity.position
			})
		})

		this.listen('death', () => {
			this.send({ type: 'DEATH' })
		})

		this.listen('entityDead', (entity: Entity) => {
			this.send({
				type: 'ENTITY_DIED',
				entity
			})
		})
		this.listen('entityGone', (entity: Entity) => {
			this.send({ type: 'REMOVE_ENTITY', entity })
		})

		this.listen('itemDrop', (entity: Entity) => {
			if (entity.name === 'broken_item') {
				this.send({ type: 'WEAPON_BROKEN' })
			}
		})
	}

	save(): Promise<void> {
		return this.isReady && !this.stopped ? this.saveMemory() : Promise.resolve()
	}

	private saveMemory(): Promise<void> {
		if (this.saving) return this.saving
		this.saveFailed = false
		this.saving = Promise.resolve()
			.then(() => this.memory.save())
			.then(() => {
				if (this.stopped) this.persistence = 'saved'
			})
			.catch(error => {
				this.saveFailed = true
				if (this.stopped) {
					this.persistence = 'failed'
					this.issues.push(
						stopIssue(
							'save',
							'memory-save-failed',
							'Required memory save failed.'
						)
					)
				}
				this.dependencies.logger.error('[HSM] memory save failed', {
					error: String(error)
				})
			})
			.finally(() => {
				this.saving = null
			})
		return this.saving
	}

	private cleanup(action: () => void, code = 'harness-cleanup-failed'): void {
		try {
			action()
		} catch (error) {
			this.issues.push(
				stopIssue('cleanup', code, 'Harness resource cleanup failed.')
			)
			this.dependencies.logger.error('[HSM] cleanup failed', {
				error: String(error)
			})
		}
	}

	private releaseRuntime(): void {
		this.isReady = false
		this.factObservers.clear()
		this.pendingEvents.length = 0
		this.cleanup(() => this.stopDiagnostics?.())
		this.stopDiagnostics = undefined
		if (this.antiLoopCooldown) clearTimeout(this.antiLoopCooldown)
		if (this.pathfindCacheCleanupInterval) {
			clearInterval(this.pathfindCacheCleanupInterval)
		}

		for (const dispose of this.subscriptions.splice(0)) this.cleanup(dispose)
		this.cleanup(() => this.actor?.stop())
		clearPathfindCache(this.bot)
	}

	private closeStore(
		store: { close(): void },
		lifecycle: StoreLifecycle
	): void {
		if (!lifecycle.started || lifecycle.loading || lifecycle.closed) return
		lifecycle.closed = true
		this.cleanup(
			() => store.close(),
			lifecycle === this.memoryLifecycle
				? 'memory-close-failed'
				: 'profile-close-failed'
		)
	}

	private closeStores(): void {
		this.closeStore(this.memory, this.memoryLifecycle)
		if (this.profileMemory)
			this.closeStore(this.profileMemory, this.profileLifecycle)
	}

	stop(): Promise<void> {
		if (this.stopPromise) return this.stopPromise
		const wasReady = this.isReady
		this.stopped = true
		this.cancelReady(false)
		this.releaseRuntime()
		if (!wasReady) {
			this.closeStores()
			this.stopPromise = Promise.resolve()
		} else {
			this.persistence = this.saving && this.saveFailed ? 'failed' : 'saved'
			if (
				this.persistence === 'failed' &&
				!this.issues.some(issue => issue.code === 'memory-save-failed')
			) {
				this.issues.push(
					stopIssue(
						'save',
						'memory-save-failed',
						'Required memory save failed.'
					)
				)
			}
			this.stopPromise = this.saveMemory().finally(() => this.closeStores())
		}
		return this.stopPromise
	}

	/** Already observed errors, even while a load or save is still pending. */
	getFinalizationIssues(): readonly StopIssue[] {
		return Object.freeze([...this.issues])
	}

	/** Low-level cancellation stays immediate; this joins all late store finalization. */
	finalize(): Promise<FinalizationReport> {
		if (this.finalization) return this.finalization
		const stopped = this.stop()
		this.finalization = Promise.all([stopped, this.initialization]).then(() =>
			freezeReport(this.persistence, this.issues)
		)
		return this.finalization
	}
}

export default BotStateMachine
