import EventEmitter from 'node:events'

import type { Bot } from '@/types/index.js'
import type {
	ConnectionSnapshot,
	StopIssue,
	StopResult
} from '@voxel-pilot/contracts'
import * as mineflayer from 'mineflayer'

import { createSecretRedactor } from '@/config/credentialRedactor.js'
import type { MinecraftConfig } from '@/config/runtimeConfig.js'
import type { RuntimeServices } from '@/config/runtimeServices.js'

import CommandHandler from '@/core/CommandHandler.js'
import BotStateMachine from '@/core/harness.js'
import { MemoryManager } from '@/core/memory/index.js'
import { ProfileMemoryStore } from '@/core/profile/index.js'

import type { HarnessDependencies } from '@/hsm/dependencies.js'
import type { NativeInspectionOptions } from '@/hsm/inspection/index.js'
import {
	type CapturedInspectionOptions,
	captureInspectionOptions
} from '@/hsm/inspection/source.js'

import { createAgentTurnRunner } from '@/ai/loop.js'
import { isAiPilotDisabled } from '@/ai/pilotAvailability.js'

import { createConnectionInitializer } from '@/modules/connection/runtimeConnection.js'

import { BotUtils } from '@/utils/minecraft/botUtils.js'

import {
	type FinalizationReport,
	freezeReport,
	stopIssue
} from './finalization.js'
import { type RuntimeFacts, deliver, measured } from './telemetry/facts.js'
import { observeNativeFacts } from './telemetry/nativeFacts.js'

export interface ConnectionDependencies {
	createBot: (options: MinecraftConfig) => Bot
	initConnection: (bot: Bot) => () => void
}

export interface MinecraftBotOptions {
	readonly inspection?: NativeInspectionOptions
}

interface BotSession {
	bot: Bot
	hsm: BotStateMachine | null
	commands: CommandHandler | null
	connectionCleanup: (() => void) | null
	listeners: Array<() => void>
	saveTimer?: ReturnType<typeof setInterval>
	disposed: boolean
	disposal: Promise<void> | null
	issues: StopIssue[]
}

class MinecraftBot extends EventEmitter {
	private readonly dependencies: ConnectionDependencies
	private readonly harnessDependencies: HarnessDependencies
	private readonly inspection?: CapturedInspectionOptions
	private readonly redactGoal: (text: string) => string
	private session: BotSession | null = null
	private closing: Promise<void> | null = null
	private readonly finalizations = new Set<Promise<FinalizationReport>>()
	private readonly pendingSessions = new Set<BotSession>()
	private persistence: FinalizationReport['persistence'] = 'not-required'
	private readonly issues = new Map<string, StopIssue>()
	private readonly observers = new Set<(snapshot: ConnectionSnapshot) => void>()
	private readonly factObservers = new Set<
		(update: { sessionId: number; facts: Partial<RuntimeFacts> }) => void
	>()
	private connection: ConnectionSnapshot = Object.freeze({
		state: 'idle',
		changedAt: Date.now(),
		sessionId: null,
		retryAttempt: 0,
		retryAt: null,
		failure: null
	})
	private generation = 0
	private nextSessionId = 0
	private resetReports = false
	private running = false
	private reconnectAttempts = 0
	private reconnectPausedGoal: string | null = null
	private reconnectTimer?: ReturnType<typeof setTimeout>
	private readonly maxReconnectAttempts = 5
	private readonly reconnectDelay = 3000

	constructor(
		private readonly services: RuntimeServices,
		dependencies: Partial<ConnectionDependencies> = {},
		options: MinecraftBotOptions = {}
	) {
		super()
		this.inspection = captureInspectionOptions(options.inspection)
		this.services = Object.freeze({ ...services })
		const { config, logger } = services
		this.redactGoal = createSecretRedactor(config.ai)
		this.dependencies = {
			createBot: options => mineflayer.createBot(options) as Bot,
			initConnection: createConnectionInitializer(logger),
			...dependencies
		}
		this.harnessDependencies = {
			logger,
			runAgentTurn: createAgentTurnRunner({
				ai: config.ai,
				logger,
				debugDump: {
					enabled: config.aiDebugDump,
					directory: config.paths.aiRequestDumpDir
				}
			}),
			aiPilotEnabled: !isAiPilotDisabled(config.ai.provider),
			minecraftVersion: config.minecraft.version,
			diagnosticsEnabled: config.diagnostics.hsmEnabled
		}
	}

	start(): void {
		if (this.running || this.session) return
		this.running = true
		this.generation++
		this.reconnectAttempts = 0
		this.resetReports = true
		this.clearReconnect()
		this.connect()
	}

	/** Internal observation seam; public consumers receive the portable facade. */
	subscribeConnection(
		listener: (snapshot: ConnectionSnapshot) => void
	): () => void {
		this.observers.add(listener)
		this.notify(listener, this.connection)
		return () => {
			this.observers.delete(listener)
		}
	}

	private notify(
		listener: (snapshot: ConnectionSnapshot) => void,
		value: ConnectionSnapshot
	): void {
		try {
			void Promise.resolve(listener(value)).catch(() => {})
		} catch {}
	}

	/** Internal session-fenced approved facts; runtime owns the portable cache. */
	subscribeFacts(
		listener: (update: {
			sessionId: number
			facts: Partial<RuntimeFacts>
		}) => void
	): () => void {
		this.factObservers.add(listener)
		return () => {
			this.factObservers.delete(listener)
		}
	}

	private publishFacts(
		session: BotSession,
		facts: Partial<RuntimeFacts>
	): void {
		if (this.session !== session || session.disposed || !this.running) return
		const sessionId = this.connection.sessionId
		if (sessionId === null) return
		const update = { sessionId, facts }
		for (const listener of [...this.factObservers]) {
			if (this.session !== session || session.disposed || !this.running) break
			if (this.factObservers.has(listener)) deliver(listener, update)
		}
	}

	private publish(update: Partial<ConnectionSnapshot>): void {
		this.connection = Object.freeze({
			...this.connection,
			...update,
			changedAt: Date.now()
		})
		const current = this.connection
		for (const observer of [...this.observers]) {
			if (this.connection !== current) break
			if (this.observers.has(observer)) this.notify(observer, current)
		}
	}

	private connect(): void {
		if (!this.running || this.session) return
		if (this.finalizations.size) {
			this.publish({ state: 'reconnecting', retryAt: null, failure: null })
			if (!this.running) return
			const generation = this.generation
			void Promise.all([...this.finalizations]).then(() => {
				if (this.running && this.generation === generation) this.connect()
			})
			return
		}
		if (this.resetReports) {
			this.persistence = 'not-required'
			this.issues.clear()
			this.resetReports = false
		}
		const generation = this.generation
		this.publish({
			state: 'connecting',
			sessionId: ++this.nextSessionId,
			retryAt: null,
			retryAttempt: this.reconnectAttempts,
			failure: null
		})
		if (!this.running || this.generation !== generation) return
		try {
			this.services.logger.info('Запуск бота...')
			if (!this.running || this.generation !== generation) return
			const bot = this.dependencies.createBot(this.services.config.minecraft)
			if (!this.running || this.generation !== generation) {
				this.cleanup(() => bot.quit('Запуск отменён'))
				return
			}
			const session: BotSession = {
				bot,
				hsm: null,
				commands: null,
				connectionCleanup: null,
				listeners: [],
				disposed: false,
				disposal: null,
				issues: []
			}
			this.session = session
			const onReady = () => {
				void this.initializeSession(session)
			}
			const onDisconnected = () => {
				if (this.session !== session) return
				void this.disposeSession(session, 'Соединение закрыто', false)
				this.scheduleReconnect()
			}
			const onError = (error: unknown) => this.failSession(session, error)
			bot.on('botReady', onReady)
			bot.on('botDisconnected', onDisconnected)
			bot.on('botError', onError)
			session.listeners.push(
				() => bot.off('botReady', onReady),
				() => bot.off('botDisconnected', onDisconnected),
				() => bot.off('botError', onError)
			)
			session.listeners.push(
				observeNativeFacts(bot, facts => this.publishFacts(session, facts))
			)
			const cleanup = this.dependencies.initConnection(bot)
			if (session.disposed)
				this.cleanup(cleanup, session.issues, 'connection-cleanup-failed')
			else session.connectionCleanup = cleanup
		} catch (error) {
			this.services.logger.error('Ошибка запуска бота', {
				error: String(error)
			})
			if (this.session)
				void this.disposeSession(this.session, 'Ошибка запуска', true)
			this.scheduleReconnect()
		}
	}

	private async initializeSession(session: BotSession): Promise<void> {
		if (this.session !== session || session.disposed || session.hsm) return
		try {
			const bot = session.bot
			bot.utils = new BotUtils(bot)
			bot.memory = new MemoryManager({
				botName: bot.username,
				dataDir: this.services.config.paths.memoryDir
			})
			bot.profileMemory = new ProfileMemoryStore({
				botName: bot.username,
				dataDir: this.services.config.paths.profileDir
			})
			const hsm = new BotStateMachine(bot, this.harnessDependencies, {
				pausedGoal: this.reconnectPausedGoal,
				inspection: this.inspection
			})
			session.hsm = hsm
			bot.hsm = hsm
			session.listeners.push(
				hsm.subscribeFacts(summary => {
					const goal =
						summary.goal.status === 'none'
							? summary.goal
							: Object.freeze({
									status: summary.goal.status,
									text: this.redactGoal(summary.goal.text).slice(0, 512)
								})
					this.publishFacts(session, {
						harness: measured(Object.freeze({ ...summary, goal }))
					})
				})
			)
			session.commands = new CommandHandler(bot, hsm, {
				logger: this.services.logger,
				aiPilotEnabled: this.harnessDependencies.aiPilotEnabled
			})
			const ready = await hsm.ready
			if (this.session !== session || session.disposed) return
			if (!ready) {
				this.failSession(session, new Error('HSM initialization failed'))
				return
			}
			const shouldResumePausedGoal =
				this.reconnectPausedGoal !== null &&
				this.harnessDependencies.aiPilotEnabled
			this.reconnectPausedGoal = null
			if (shouldResumePausedGoal) hsm.resumePausedGoal()
			if (this.session !== session || session.disposed || !this.running) return
			this.reconnectAttempts = 0
			this.publish({ state: 'ready', retryAttempt: 0, retryAt: null })
			if (this.session !== session || session.disposed || !this.running) return
			session.saveTimer = setInterval(
				() => {
					void hsm.save()
				},
				5 * 60 * 1000
			)
			bot.chat('Я готов к работе ;)')
		} catch (error) {
			this.failSession(session, error)
		}
	}

	private failSession(session: BotSession, error: unknown): void {
		if (this.session !== session || session.disposed) return
		this.services.logger.error('Ошибка сессии бота', { error: String(error) })
		void this.disposeSession(session, 'Ошибка сессии', true)
		this.scheduleReconnect()
	}

	private cleanup(
		action: () => void,
		issues: StopIssue[] = [],
		code = 'session-cleanup-failed'
	): void {
		try {
			action()
		} catch (error) {
			issues.push(
				stopIssue(
					code.startsWith('connection') ? 'connection' : 'cleanup',
					code,
					'Session resource cleanup failed.'
				)
			)
			this.services.logger.error('Ошибка очистки сессии', {
				error: String(error)
			})
		}
	}

	private disposeSession(
		session: BotSession,
		reason: string,
		disconnect: boolean
	): Promise<void> {
		if (session.disposal) return session.disposal
		this.pendingSessions.add(session)
		session.disposed = true
		if (this.running && session.hsm) {
			const reconnectGoal = session.hsm.getReconnectGoal()
			if (reconnectGoal) this.reconnectPausedGoal = reconnectGoal
		}
		if (this.session === session) this.session = null
		if (session.saveTimer) clearInterval(session.saveTimer)
		for (const dispose of session.listeners.splice(0))
			this.cleanup(dispose, session.issues)
		this.cleanup(() => session.commands?.stop(), session.issues)
		let stopped: Promise<void> = Promise.resolve()
		this.cleanup(() => {
			stopped = session.hsm?.stop() ?? stopped
		}, session.issues)
		// Stop behavior before waiting for persistence or asking the connection to close.
		if (disconnect)
			this.cleanup(
				() => session.bot.quit(reason),
				session.issues,
				'connection-quit-failed'
			)
		this.cleanup(
			() => session.connectionCleanup?.(),
			session.issues,
			'connection-cleanup-failed'
		)
		session.connectionCleanup = null
		const disposal = stopped
			.catch(error => {
				session.issues.push(
					stopIssue(
						'cleanup',
						'harness-stop-failed',
						'Harness cancellation failed.'
					)
				)
				this.services.logger.error('Ошибка остановки HSM', {
					error: String(error)
				})
			})
			.finally(() => {
				if (this.closing === disposal) this.closing = null
			})
		this.closing = disposal
		session.disposal = disposal
		const finalization = Promise.resolve()
			.then(() => session.hsm?.finalize())
			.then(
				report =>
					freezeReport(report?.persistence ?? 'not-required', [
						...session.issues,
						...(report?.issues ?? [])
					]),
				() =>
					freezeReport('failed', [
						...session.issues,
						stopIssue(
							'cleanup',
							'harness-finalization-failed',
							'Harness finalization failed.'
						)
					])
			)
			.then(report => {
				if (
					report.persistence === 'failed' ||
					(this.persistence !== 'failed' && report.persistence === 'saved')
				)
					this.persistence = report.persistence
				for (const issue of report.issues)
					this.issues.set(`${issue.stage}:${issue.code}`, issue)
				this.finalizations.delete(finalization)
				this.pendingSessions.delete(session)
				return report
			})
		this.finalizations.add(finalization)
		return session.disposal
	}

	stop(reason: string = 'Бот остановлен вручную.'): Promise<void> {
		this.running = false
		this.generation++
		this.reconnectPausedGoal = null
		this.clearReconnect()
		this.reconnectAttempts = 0
		const stopped = this.session
			? this.disposeSession(this.session, reason, true)
			: (this.closing ?? Promise.resolve())
		if (this.connection.state !== 'stopping')
			this.publish({ state: 'stopping', retryAt: null })
		return stopped
	}

	async finalize(): Promise<FinalizationReport> {
		await Promise.all([...this.finalizations])
		return freezeReport(this.persistence, [...this.issues.values()])
	}

	getFinalizationIssues(): readonly StopIssue[] {
		const issues = new Map(this.issues)
		for (const session of this.pendingSessions) {
			for (const issue of [
				...session.issues,
				...(session.hsm?.getFinalizationIssues() ?? [])
			]) {
				issues.set(`${issue.stage}:${issue.code}`, issue)
			}
		}
		return Object.freeze([...issues.values()])
	}

	completeStop(result: StopResult): void {
		if (this.running) return
		this.publish({
			state: result.outcome === 'stopped' ? 'stopped' : 'failed',
			retryAt: null,
			failure:
				this.connection.failure ??
				(result.issues[0]
					? Object.freeze({
							code: result.issues[0].code,
							message: result.issues[0].message
						})
					: null)
		})
	}

	private clearReconnect(): void {
		if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
		this.reconnectTimer = undefined
	}

	private scheduleReconnect(): void {
		if (!this.running || this.reconnectTimer || this.session) return
		if (this.reconnectAttempts >= this.maxReconnectAttempts) {
			this.running = false
			this.services.logger.error(
				'Превышено число попыток реконнекта. Бот больше не подключается.'
			)
			this.publish({
				state: 'failed',
				retryAt: null,
				failure: Object.freeze({
					code: 'connection-retries-exhausted',
					message: 'Connection failed after the final retry.'
				})
			})
			return
		}
		const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts++)
		this.services.logger.info(
			`Попытка реконнекта через ${delay / 1000} секунд...`
		)
		this.reconnectTimer = setTimeout(() => {
			this.reconnectTimer = undefined
			this.connect()
		}, delay)
		this.publish({
			state: 'reconnecting',
			retryAttempt: this.reconnectAttempts,
			retryAt: Date.now() + delay
		})
	}
}

export default MinecraftBot
