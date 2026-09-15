import { Vec3 as Vec3Class } from 'vec3'
import {
	and,
	assign,
	enqueueActions,
	fromCallback,
	fromPromise,
	not,
	setup,
	stateIn,
	stopChild
} from 'xstate'
import type { AnyActorLogic } from 'xstate'

import type { Bot, Entity } from '@/types'

import Logger from '@/config/logger'

import { miningActions } from '@/hsm/actions/mining.actions'
import { safetyActions } from '@/hsm/actions/safety.actions'
import combatActors from '@/hsm/actors/combat.actors'
import { idleGaze } from '@/hsm/actors/idleGaze.actors'
import monitoringActors from '@/hsm/actors/monitoring.actors'
import { primitiveBreaking } from '@/hsm/actors/primitives/primitiveBreaking.primitive'
import { primitiveCloseWindow } from '@/hsm/actors/primitives/primitiveCloseWindow.primitive'
import { primitiveFollowing } from '@/hsm/actors/primitives/primitiveFollowing.primitive'
import { primitiveNavigating } from '@/hsm/actors/primitives/primitiveNavigating.primitive'
import { primitiveOpenWindow } from '@/hsm/actors/primitives/primitiveOpenWindow.primitive'
import { primitivePlacing } from '@/hsm/actors/primitives/primitivePlacing.primitive'
import { primitiveSearchBlock } from '@/hsm/actors/primitives/primitiveSearchBlock.primitive'
import { primitiveTransferItem } from '@/hsm/actors/primitives/primitiveTransferItem.primitive'
import survivalActors from '@/hsm/actors/survival.actors'
import { worldObservation } from '@/hsm/actors/worldObservation.actors'
import { type MachineContext, context } from '@/hsm/context'
import combatGuards, {
	eventCanAutoEnterCombat,
	eventCanSkirmishRanged,
	eventCanSkirmishRangedFromMelee,
	eventEnemyInMeleeRange,
	isCombatTargetUpdateEvent
} from '@/hsm/guards/combat.guards'
import { miningGuards } from '@/hsm/guards/mining.guards'
import {
	canAttemptRecovery,
	canPreemptForHungerRecovery,
	hasFreshThreatObservation,
	isHungerRecoverySafe,
	isRecoverySafe
} from '@/hsm/guards/survival.guards'
import type { MachineEvent, MiningTaskData } from '@/hsm/types'
import { observeThreats } from '@/hsm/utils/threatObservation'

import type { AgentTurnResult } from '@/ai/contracts/agentTurn.js'
import { appendConversationEntry } from '@/ai/conversationHistory.js'
import {
	advanceGoalExecution,
	createGoalExecution,
	getGoalStopReason
} from '@/ai/goalExecution.js'
import { runAgentTurn } from '@/ai/loop.js'
import { type WindowRuntime, getWindowRuntime } from '@/ai/runtime/window.js'
import { createTaskContext } from '@/ai/taskContext.js'
import { parseExecution } from '@/ai/tools/executionDefinitions.js'

import { refreshApproaches } from '@/utils/combat/approachPolicy'
import { hasMovementController } from '@/utils/combat/movementController'
import {
	assessMob,
	hasCombatWeapon,
	isDefensiveCandidate,
	nearestRetreatCreeper,
	requiresAvoidance,
	selectCombatTarget
} from '@/utils/combat/selfDefense'
import { isFinitePosition } from '@/utils/minecraft/spatial'

const defaultThinkingActor = fromPromise<
	AgentTurnResult,
	{
		bot: Bot
		context: MachineContext
	}
>(async ({ input, signal }) => {
	if (!input.context.currentGoal) {
		throw new Error('No current goal to think about')
	}

	return runAgentTurn({
		bot: input.bot,
		memory: input.bot.memory,
		currentGoal: input.context.currentGoal,
		subGoal: input.context.subGoal,
		conversationHistory: input.context.conversationHistory,
		userProfilePrompt: input.bot.profileMemory?.getProfilePrompt() ?? null,
		lastAction: input.context.lastAction,
		lastResult: input.context.lastResult,
		lastReason: input.context.lastReason,
		errorHistory: input.context.errorHistory,
		taskContext: input.context.taskContext,
		windows: input.context.windows!,
		signal
	})
})

const normalizeEntitySelector = (value: unknown): string | null => {
	if (typeof value !== 'string') {
		return null
	}

	const normalized = value.trim().toLowerCase()
	return normalized.length > 0 ? normalized : null
}

const toVec3 = (position: { x: number; y: number; z: number }) =>
	new Vec3Class(position.x, position.y, position.z)

const requireMiningExecution = (context: MachineContext) => {
	if (context.pendingExecution?.toolName !== 'mine_resource')
		throw new Error('Expected a mining action')
	return context.pendingExecution.args
}

type ExecutionActorInput = {
	bot: Bot | null
	options: Record<string, unknown>
}

const resolveExecutionInput = (
	context: MachineContext
): ExecutionActorInput => {
	const bot = context.bot
	const execution = context.pendingExecution

	if (!bot || !execution) {
		return {
			bot,
			options: {}
		}
	}

	switch (execution.toolName) {
		case 'navigate_to':
			return {
				bot,
				options: {
					target: toVec3(execution.args.position),
					range: execution.args.range
				}
			}
		case 'break_block': {
			const targetPosition = toVec3(execution.args.position)
			const block = bot.blockAt(targetPosition)
			return {
				bot,
				options: {
					block
				}
			}
		}
		case 'open_window':
			return {
				bot,
				options: {
					position: toVec3(execution.args.position)
				}
			}
		case 'transfer_item':
			return {
				bot,
				options: {
					sourceZone: execution.args.source_zone,
					destZone: execution.args.dest_zone,
					itemName: execution.args.item_name,
					count: execution.args.count
				}
			}
		case 'close_window':
			return {
				bot,
				options: {}
			}
		case 'place_block':
			return {
				bot,
				options: {
					blockName: execution.args.block_name,
					position: toVec3(execution.args.position),
					faceVector: execution.args.face_vector
						? toVec3(execution.args.face_vector)
						: undefined
				}
			}
		case 'follow_entity': {
			const requestedName = normalizeEntitySelector(execution.args.entity_name)
			const requestedType = normalizeEntitySelector(execution.args.entity_type)
			const maxDistance =
				execution.args.max_distance ?? Number.POSITIVE_INFINITY
			const target = bot.nearestEntity((entity: Entity) => {
				if (!entity?.position) {
					return false
				}

				if (bot.entity?.id && entity.id === bot.entity.id) {
					return false
				}

				if (entity.position.distanceTo(bot.entity.position) > maxDistance) {
					return false
				}

				const entityUsername = normalizeEntitySelector(entity.username)
				const entityName = normalizeEntitySelector(entity.name)
				const entityType = normalizeEntitySelector(entity.type)

				const matchesName = requestedName
					? entityUsername === requestedName || entityName === requestedName
					: true
				const matchesType = requestedType
					? entityType === requestedType || entityName === requestedType
					: true

				return (
					Boolean(requestedName || requestedType) && matchesName && matchesType
				)
			})
			return {
				bot,
				options: {
					target,
					distance: execution.args.distance
				}
			}
		}
		default:
			return {
				bot,
				options: {}
			}
	}
}

interface MachineFactoryOptions {
	preferences?: Partial<MachineContext['preferences']>
	thinkingActor?: AnyActorLogic
	actors?: Record<string, AnyActorLogic>
}

type ThinkingDoneEvent = {
	output?: AgentTurnResult
}

export const createBotMachine = (options?: MachineFactoryOptions) => {
	const actorOverrides = options?.actors ?? {}
	const preferences = { ...context.preferences, ...options?.preferences }
	for (const [name, value] of Object.entries(preferences)) {
		if (typeof value !== 'number') continue
		const permitsZero = name === 'approachChangedConditionRetries'
		if (
			!Number.isFinite(value) ||
			(permitsZero ? value < 0 : value <= 0) ||
			(/Attempts$|Retries$/.test(name) && !Number.isInteger(value))
		) {
			throw new Error(`Invalid preference: ${name}`)
		}
	}
	if (
		preferences.healthEmergency >= preferences.healthFullyRestored ||
		preferences.healthFullyRestored > 20 ||
		preferences.foodEmergency >= preferences.foodRestored ||
		preferences.foodRestored > 20
	) {
		throw new Error(
			'Recovery thresholds must satisfy emergency < restored <= 20'
		)
	}
	if (
		!Number.isFinite(preferences.interruptEatDistance) ||
		!Number.isFinite(preferences.safeEatDistance) ||
		preferences.interruptEatDistance <= 0 ||
		preferences.interruptEatDistance >= preferences.safeEatDistance
	) {
		throw new Error(
			'Eating distance must satisfy 0 < interruptEatDistance < safeEatDistance'
		)
	}

	return setup({
		types: {} as {
			context: MachineContext
			events: MachineEvent
			input: { bot: Bot }
		},
		delays: {
			recoveryRetry: ({ context }) => context.preferences.recoveryRetryMs
		},
		actors: {
			idleGaze,
			serviceTacticalRetreat: survivalActors.serviceTacticalRetreat,
			worldObservation,
			windowLifetime: fromCallback<MachineEvent, WindowRuntime>(
				({ input }) =>
					() => {
						input.close()
					}
			),
			agentThinking:
				actorOverrides.agentThinkingTurn ??
				options?.thinkingActor ??
				defaultThinkingActor,
			emergencyEating:
				actorOverrides.serviceEmergencyEating ??
				survivalActors.serviceEmergencyEating,
			emergencyHealing:
				actorOverrides.serviceEmergencyHealing ??
				survivalActors.serviceEmergencyHealing,
			serviceEntitiesTracking:
				actorOverrides.serviceEntitiesTracking ??
				monitoringActors.serviceEntitiesTracking,
			serviceMeleeAttack:
				actorOverrides.serviceMeleeAttack ?? combatActors.serviceMeleeAttack,
			serviceRangedSkirmish:
				actorOverrides.serviceRangedSkirmish ??
				actorOverrides.serviceRangedAttack ??
				combatActors.serviceRangedSkirmish
		},
		guards: {
			...combatGuards,
			...miningGuards,
			hasCurrentGoal: ({ context }) => Boolean(context.currentGoal),
			isAgentLoopStuck: ({ context }) =>
				getGoalStopReason(context.goalExecution) !== null,
			thinkingProducedRejection: ({ event }) =>
				(event as ThinkingDoneEvent).output?.kind === 'rejected',
			thinkingProducedInvalidExecution: ({ event }) => {
				const output = (event as ThinkingDoneEvent).output
				return (
					output?.kind === 'execute' &&
					!parseExecution(output.execution.toolName, output.execution.args).ok
				)
			},
			thinkingProducedExecution: ({ event }) =>
				(event as ThinkingDoneEvent).output?.kind === 'execute',
			thinkingProducedFinish: ({ event }) =>
				(event as ThinkingDoneEvent).output?.kind === 'finish',
			isNavigateExecution: ({ context }) =>
				context.pendingExecution?.toolName === 'navigate_to',
			isBreakExecution: ({ context }) =>
				context.pendingExecution?.toolName === 'break_block',
			isOpenWindowExecution: ({ context }) =>
				context.pendingExecution?.toolName === 'open_window',
			isTransferItemExecution: ({ context }) =>
				context.pendingExecution?.toolName === 'transfer_item',
			isCloseWindowExecution: ({ context }) =>
				context.pendingExecution?.toolName === 'close_window',
			isPlaceExecution: ({ context }) =>
				context.pendingExecution?.toolName === 'place_block',
			isFollowExecution: ({ context }) =>
				context.pendingExecution?.toolName === 'follow_entity',
			isMiningExecution: ({ context }) =>
				context.pendingExecution?.toolName === 'mine_resource'
		},
		actions: {
			...miningActions,
			...safetyActions,
			logStateEntry: ({ context, event }, params: unknown) => {
				const state =
					params && typeof params === 'object' && 'state' in params
						? String(params.state)
						: 'unknown'
				Logger.debug(`[HSM] enter ${state}`, {
					event: event.type,
					targetId: context.combatTarget.entity?.id ?? null,
					distance: Number.isFinite(context.combatTarget.distance)
						? Number(context.combatTarget.distance.toFixed(2))
						: null
				})
			},
			logStateExit: ({ context, event }, params: unknown) => {
				const state =
					params && typeof params === 'object' && 'state' in params
						? String(params.state)
						: 'unknown'
				Logger.debug(`[HSM] exit ${state}`, {
					event: event.type,
					targetId: context.combatTarget.entity?.id ?? null,
					distance: Number.isFinite(context.combatTarget.distance)
						? Number(context.combatTarget.distance.toFixed(2))
						: null
				})
			},
			logCombatWaiting: ({ context }) => {
				const targetId = context.combatTarget.entity?.id
				const attempt =
					targetId === undefined
						? undefined
						: context.approachAttempts[targetId]
				Logger.info('[COMBAT] waiting', {
					targetId: targetId ?? null,
					reason: attempt?.blocked
						? `${attempt.blockedReason}_blocked`
						: 'attack_unavailable',
					resumes: attempt?.resumes ?? 0,
					rangedUnavailable: context.rangedUnavailable
				})
			},
			logThinkingStart: ({ context }) => {
				Logger.debug('[AI] thinking_start', {
					goal: context.currentGoal,
					subGoal: context.subGoal,
					lastAction: context.lastAction,
					lastResult: context.lastResult
				})
			},
			logThinkingExecution: ({ event }) => {
				const output = (event as ThinkingDoneEvent).output
				if (!output || output.kind !== 'execute') {
					return
				}

				Logger.debug('[AI] thinking_done', {
					kind: output.kind,
					toolName: output.execution.toolName,
					args: output.execution.args,
					subGoal: output.subGoal
				})
			},
			logThinkingFinish: ({ event }) => {
				const output = (event as ThinkingDoneEvent).output
				if (!output || output.kind !== 'finish') {
					return
				}

				Logger.debug('[AI] thinking_done', {
					kind: output.kind,
					message: output.message
				})
			},
			logThinkingFailure: ({ event }) => {
				const output = (event as ThinkingDoneEvent).output
				if (!output || output.kind !== 'failed') {
					return
				}

				Logger.info('[AI] thinking_done', {
					kind: output.kind,
					reason: output.reason,
					transcript: output.transcript
				})
			},
			logThinkingError: ({ event }) => {
				const error =
					(event as { error?: unknown }).error ?? 'Unknown thinking error'
				Logger.error('[AI] thinking_error', {
					error: error instanceof Error ? error.message : String(error)
				})
			},
			updatePosition: assign({
				position: ({ event }) =>
					event.type === 'UPDATE_POSITION' ? event.position : null,
				timeOfDay: ({ context }) => context.bot?.time?.timeOfDay ?? null
			}),
			updateFoodSaturation: assign({
				foodSaturation: ({ event }) =>
					event.type === 'UPDATE_SATURATION' ? event.foodSaturation : 0
			}),
			updateHealth: assign({
				recoveryFailure: ({ context, event }) =>
					event.type === 'UPDATE_HEALTH' &&
					event.health >= context.preferences.healthFullyRestored &&
					context.food >= context.preferences.foodRestored
						? null
						: context.recoveryFailure,
				health: ({ context, event }) => {
					if (event.type !== 'UPDATE_HEALTH') {
						return 20
					}

					if (context.health !== event.health)
						Logger.debug(`[HSM] health ${context.health} -> ${event.health}`, {
							event: event.type
						})

					return event.health
				}
			}),
			updateFood: assign({
				recoveryFailure: ({ context, event }) =>
					event.type === 'UPDATE_FOOD' &&
					event.food >= context.preferences.foodRestored &&
					context.health >= context.preferences.healthFullyRestored
						? null
						: context.recoveryFailure,
				food: ({ context, event }) => {
					if (event.type !== 'UPDATE_FOOD') {
						return 20
					}

					if (context.food !== event.food)
						Logger.debug(`[HSM] food ${context.food} -> ${event.food}`, {
							event: event.type
						})

					return event.food
				}
			}),
			updateOxygen: assign({
				oxygenLevel: ({ event }) =>
					event.type === 'UPDATE_OXYGEN' ? event.oxygenLevel : 20
			}),
			updateEntities: assign(({ context, event }) => {
				if (event.type !== 'UPDATE_ENTITIES') return {}
				const observedEntities = [
					...event.enemies,
					...event.entities,
					...event.players
				]
				const problem = !isFinitePosition(context.bot?.entity?.position)
					? 'invalid_bot_position'
					: observedEntities.some(entity => !isFinitePosition(entity.position))
						? 'invalid_entity_position'
						: null
				if (problem)
					return {
						threatObservationAt: null,
						threatObservationProblem: problem
					}
				return {
					threatObservationAt: Date.now(),
					threatObservationProblem: null,
					deadEntities: new Set(
						[...context.deadEntities].filter(
							entity =>
								context.bot?.entities[entity.id] === entity ||
								observedEntities.includes(entity)
						)
					),
					aggressionByEntity: Object.fromEntries(
						Object.entries(context.aggressionByEntity).filter(
							([, observedAt]) =>
								Date.now() - observedAt <
								context.preferences.aggressionRetentionMs
						)
					),
					approachAttempts: refreshApproaches(
						context,
						new Set(event.enemies.map(entity => entity.id))
					),
					entities: event.entities,
					enemies: event.enemies.filter(
						entity => !context.deadEntities.has(entity)
					),
					players: event.players,
					...(context.bot
						? observeThreats(
								context.threats,
								observedEntities,
								context.bot.entity.position,
								Date.now(),
								context.preferences.threatRetentionMs,
								entity => assessMob(context, entity),
								context.bot
							)
						: {})
				}
			}),
			updateCombatTarget: enqueueActions(({ context, enqueue }) => {
				const combatTarget = selectCombatTarget(context)
				enqueue.assign({
					combatTarget,
					combatStopRequested:
						context.combatStopRequested && combatTarget.entity !== null
				})
				enqueue('notifyMissingCombatWeapon')
			}),
			notifyMissingCombatWeapon: enqueueActions(
				({ context, event, enqueue }) => {
					if (hasCombatWeapon(context)) {
						enqueue.assign({ combatNoWeaponNotified: false })
						return
					}
					const target =
						event.type === 'START_COMBAT'
							? event.target
							: context.combatTarget.entity
					if (
						!context.combatNoWeaponNotified &&
						context.health >= context.preferences.healthEmergency &&
						(event.type === 'START_COMBAT' ||
							(context.preferences.autoDefend &&
								!context.combatStopRequested)) &&
						isDefensiveCandidate(context, target)
					) {
						enqueue('sendMissingCombatWeaponMessage')
						enqueue.assign({ combatNoWeaponNotified: true })
					}
				}
			),
			sendMissingCombatWeaponMessage: ({ context }) => {
				context.bot?.chat('Оружия нет (или нет боеприпасов). Бой не начинаю.')
			},

			removeEntity: assign(({ context, event }) => {
				if (event.type !== 'REMOVE_ENTITY' && event.type !== 'ENTITY_DIED') {
					return {}
				}

				const died = event.type === 'ENTITY_DIED'
				const threats = died
					? context.threats.filter(
							threat => threat.entityId !== event.entity.id
						)
					: context.threats
				const remaining = {
					...context,
					deadEntities: died
						? new Set([...context.deadEntities, event.entity])
						: context.deadEntities,
					threats,
					nearestThreat: threats[0] ?? null,
					aggressionByEntity: died
						? Object.fromEntries(
								Object.entries(context.aggressionByEntity).filter(
									([id]) => Number(id) !== event.entity.id
								)
							)
						: context.aggressionByEntity,
					approachAttempts: died
						? Object.fromEntries(
								Object.entries(context.approachAttempts).filter(
									([id]) => Number(id) !== event.entity.id
								)
							)
						: context.approachAttempts,
					entities: context.entities.filter(
						entity => entity.id !== event.entity.id
					),
					enemies: context.enemies.filter(
						entity => entity.id !== event.entity.id
					),
					players: context.players.filter(
						entity => entity.id !== event.entity.id
					),
					preferredCombatTargetId:
						context.preferredCombatTargetId === event.entity.id
							? null
							: context.preferredCombatTargetId,
					combatStopRequested:
						context.combatTarget.entity?.id === event.entity.id
							? false
							: context.combatStopRequested
				}
				return {
					...remaining,
					combatTarget:
						context.combatTarget.entity?.id === event.entity.id
							? selectCombatTarget(remaining)
							: context.combatTarget
				}
			}),
			invalidateFailedThreatObservation: assign({
				threatObservationAt: null,
				threatObservationProblem: 'observer_failed'
			}),
			updateAfterDeath: assign({
				combatNoWeaponNotified: false,
				recoveryRelocation: null,
				aggressionByEntity: {},
				recoveryNoFoodNotified: false,
				threatObservationAt: null,
				threatObservationProblem: null,
				approachAttempts: {},
				lastDamage: {
					sequence: 0,
					observedAt: 0,
					sourceId: null,
					sourcePosition: null
				},
				health: 0,
				nearestThreat: null,
				threats: [],
				entities: [],
				enemies: [],
				players: [],
				inventory: [],
				combatTarget: {
					entity: null,
					distance: Infinity
				},
				movementOwner: 'NONE',
				currentGoal: null,
				subGoal: null,
				taskContext: createTaskContext(null, null),
				pendingExecution: null,
				lastToolTranscript: [],
				preferredCombatTargetId: null,
				combatStopRequested: false,
				rangedUnavailable: false,
				recoveryFailure: null,
				goalExecution: createGoalExecution()
			}),
			markTaskActive: assign({
				isActiveTask: true
			}),
			markTaskInactive: assign({
				isActiveTask: false,
				pendingExecution: null,
				goalExecution: ({ context }) =>
					advanceGoalExecution(context.goalExecution, { type: 'interrupted' }),
				taskData: null
			}),
			setGoalFromUserCommand: assign(({ context, event }) => {
				if (event.type !== 'USER_COMMAND') {
					return {}
				}

				return {
					currentGoal: event.text,
					subGoal: null,
					conversationHistory: appendConversationEntry(
						context.conversationHistory,
						{
							role: 'user',
							username: event.username,
							message: event.text
						}
					),
					taskContext: createTaskContext(event.text, null),
					pendingExecution: null,
					lastToolTranscript: [],
					goalExecution: createGoalExecution(),
					errorHistory: []
				}
			}),
			clearGoal: assign(() => {
				return {
					currentGoal: null,
					subGoal: null,
					taskContext: createTaskContext(null, null),
					pendingExecution: null,
					lastToolTranscript: [],
					goalExecution: createGoalExecution(),
					preferredCombatTargetId: null,
					combatStopRequested: false
				}
			}),
			appendFinishConversationEntry: assign(({ context, event }) => {
				const output = (event as ThinkingDoneEvent).output
				if (!output || output.kind !== 'finish') {
					return {}
				}

				return {
					conversationHistory: appendConversationEntry(
						context.conversationHistory,
						{
							role: 'assistant',
							message: output.message
						}
					)
				}
			}),
			appendFailureConversationEntry: assign(({ context }) => {
				if (!context.lastReason) {
					return {}
				}

				return {
					conversationHistory: appendConversationEntry(
						context.conversationHistory,
						{
							role: 'assistant',
							message: `Не могу продолжить задачу: ${context.lastReason}`
						}
					)
				}
			}),
			closeActiveWindowSession: ({ context }) => {
				context.windows?.close()
			},
			recordRecoveryFailure: assign(({ event }) => ({
				lastAction: 'survival_recovery',
				lastActionArgs: null,
				recoveryFailure:
					event.type === 'RECOVERY_FAILED' ? event.cause : ('error' as const),
				lastReason:
					event.type === 'RECOVERY_FAILED'
						? event.reason
						: event.type === 'ERROR'
							? event.error
							: 'Recovery service failed',
				lastResult: 'FAILED' as const
			})),
			clearRecoveryFailure: assign({ recoveryFailure: null }),
			disableRanged: assign({ rangedUnavailable: true }),
			recordCombatFailure: assign(({ event }) => ({
				lastAction: 'combat',
				lastActionArgs: null,
				lastResult: 'FAILED' as const,
				lastReason:
					event.type === 'ERROR' ? event.error : 'Combat service failed'
			})),
			resetRanged: assign({ rangedUnavailable: false }),
			setCombatTargetFromEvent: assign(({ context, event }) => {
				if (event.type !== 'START_COMBAT' || !event.target) {
					return {
						preferredCombatTargetId: null,
						combatStopRequested: false
					}
				}

				return {
					preferredCombatTargetId: event.target.id,
					combatStopRequested: false,
					combatTarget: {
						entity: event.target,
						distance:
							context.bot?.entity?.position?.distanceTo(
								event.target.position
							) ?? context.combatTarget.distance
					}
				}
			}),
			setCombatTargetFromObservation: assign(({ context }) => ({
				preferredCombatTargetId: context.combatTarget.entity?.id ?? null,
				combatStopRequested: false
			})),
			suppressCombatAutoEntry: assign({
				combatStopRequested: true
			}),
			clearCombatTarget: assign({
				movementOwner: 'NONE',
				preferredCombatTargetId: null,
				combatTarget: { entity: null, distance: Infinity }
			}),
			ownMovementNone: assign({
				movementOwner: 'NONE'
			}),
			ownMovementPvp: assign({
				movementOwner: 'PVP'
			}),
			syncSurvivalModeOwner: assign({
				movementOwner: ({ event, context }) => {
					if (event.type !== 'SURVIVAL_MODE_CHANGED') {
						return context.movementOwner
					}

					switch (event.mode) {
						case 'MOVEMENT':
							return hasMovementController(context.bot) ? 'MOVEMENT' : 'NONE'
						case 'PATHFINDER':
							return 'PATHFINDER'
						case 'EATING':
						case 'IDLE':
						default:
							return 'NONE'
					}
				}
			}),
			storeThinkingExecution: assign(({ context, event }) => {
				const output = (event as ThinkingDoneEvent).output
				if (!output || output.kind !== 'execute') {
					return {}
				}

				return {
					pendingExecution: output.execution,
					goalExecution: advanceGoalExecution(context.goalExecution, {
						type: 'started'
					}),
					subGoal: output.subGoal,
					lastToolTranscript: output.transcript,
					taskContext: createTaskContext(context.currentGoal, output.subGoal)
				}
			}),
			storeThinkingFailure: assign(({ context, event }) => {
				let output = (event as ThinkingDoneEvent).output
				if (output?.kind === 'execute') {
					const parsed = parseExecution(
						output.execution.toolName,
						output.execution.args
					)
					if (!parsed.ok)
						output = {
							kind: 'rejected',
							reason: parsed.reason,
							transcript: output.transcript
						}
				}
				if (!output || (output.kind !== 'failed' && output.kind !== 'rejected'))
					return {}
				return {
					lastResult: 'FAILED' as const,
					lastReason: output.reason,
					lastToolTranscript: output.transcript,
					pendingExecution: null,
					errorHistory: [...context.errorHistory, output.reason].slice(-3),
					goalExecution: advanceGoalExecution(context.goalExecution, {
						type: output.kind === 'rejected' ? 'rejected' : 'failed',
						reason: output.reason
					})
				}
			}),
			recordExecutionSuccess: assign(({ context, event }) => ({
				lastAction: context.pendingExecution?.toolName ?? context.lastAction,
				lastActionArgs:
					context.pendingExecution?.args ?? context.lastActionArgs,
				lastResult: 'SUCCESS' as const,
				lastReason: null,
				pendingExecution: null,
				goalExecution: advanceGoalExecution(context.goalExecution, {
					type: 'succeeded'
				}),
				lastToolTranscript: [event.type],
				taskContext: createTaskContext(context.currentGoal, context.subGoal)
			})),
			recordExecutionFailure: assign(({ context, event }) => {
				const reason =
					'reason' in event && typeof event.reason === 'string'
						? event.reason
						: event.type === 'ERROR'
							? event.error
							: 'Unknown execution failure'
				return {
					lastAction: context.pendingExecution?.toolName ?? context.lastAction,
					lastActionArgs:
						context.pendingExecution?.args ?? context.lastActionArgs,
					lastResult: 'FAILED' as const,
					lastReason: reason,
					pendingExecution: null,
					goalExecution: advanceGoalExecution(context.goalExecution, {
						type: 'failed',
						reason
					}),
					errorHistory: [...context.errorHistory, reason].slice(-3),
					lastToolTranscript: [event.type]
				}
			}),
			notifyGoalFinished: ({ context, event }) => {
				const output = (event as ThinkingDoneEvent).output
				if (output?.kind === 'finish') {
					context.bot?.chat(output.message)
				}
			},
			notifyThinkingFailure: ({ context }) => {
				if (context.lastReason) {
					context.bot?.chat(`Не могу продолжить задачу: ${context.lastReason}`)
				}
			},
			notifyLoopAbort: ({ context }) => {
				const reason = getGoalStopReason(context.goalExecution)
				if (reason) context.bot?.chat(reason)
			}
		}
	}).createMachine({
		id: 'MINECRAFT_BOT',
		type: 'parallel',
		context: ({ input }) => ({
			...context,
			preferences: { ...preferences },
			bot: input.bot,
			health: input.bot.health,
			food: input.bot.food,
			foodSaturation: input.bot.foodSaturation,
			oxygenLevel: input.bot.oxygenLevel,
			position: input.bot.entity?.position ?? null,
			aggressionByEntity: {},
			windows: getWindowRuntime(input.bot),
			goalExecution: createGoalExecution()
		}),
		invoke: [
			{ src: 'windowLifetime', input: ({ context }) => context.windows! },
			{
				src: 'worldObservation',
				input: ({ context }) => ({ bot: context.bot! })
			}
		],
		on: {
			THREAT_OBSERVATION_INVALID: {
				actions: assign(({ event }) => ({
					threatObservationAt: null,
					threatObservationProblem: event.reason
				}))
			},
			PASSABILITY_CHANGED: { actions: 'observePassability' },
			DAMAGE_OBSERVED: { actions: ['observeDamage', 'cancelDamagedEating'] },
			RECOVERY_RELOCATION: { actions: 'storeRecoveryRelocation' },
			RECOVERY_FOOD_AVAILABILITY: { actions: 'observeRecoveryFood' },
			UPDATE_POSITION: {
				actions: ['updatePosition', 'refreshRecoveryPosition']
			},
			UPDATE_SATURATION: {
				actions: ['updateFoodSaturation']
			},
			UPDATE_OXYGEN: {
				actions: ['updateOxygen']
			},
			DEATH: {
				target: '#MINECRAFT_BOT.MAIN_ACTIVITY.IDLE',
				actions: ['closeActiveWindowSession', 'updateAfterDeath']
			},
			USER_COMMAND: {
				target: '#MINECRAFT_BOT.MAIN_ACTIVITY.TASKS.THINKING',
				actions: ['closeActiveWindowSession', 'setGoalFromUserCommand']
			},
			STOP_CURRENT_GOAL: {
				target: '#MINECRAFT_BOT.MAIN_ACTIVITY.IDLE',
				actions: ['closeActiveWindowSession', 'clearGoal']
			},
			START_COMBAT: [
				{
					guard: ({ context, event }) =>
						hasCombatWeapon(context) &&
						isDefensiveCandidate(context, event.target),
					target: '#MINECRAFT_BOT.MAIN_ACTIVITY.COMBAT',
					actions: [
						'closeActiveWindowSession',
						'resetRanged',
						'setCombatTargetFromEvent'
					]
				},
				{ actions: 'notifyMissingCombatWeapon' }
			],
			STOP_COMBAT: [
				{
					guard: 'hasCurrentGoal',
					target: '#MINECRAFT_BOT.MAIN_ACTIVITY.TASKS.THINKING',
					actions: ['suppressCombatAutoEntry', 'clearCombatTarget']
				},
				{
					target: '#MINECRAFT_BOT.MAIN_ACTIVITY.IDLE',
					actions: ['suppressCombatAutoEntry', 'clearCombatTarget']
				}
			],
			START_URGENT_NEEDS: [
				{
					guard: ({ event }) =>
						event.type === 'START_URGENT_NEEDS' && event.need === 'food',
					actions: ['closeActiveWindowSession'],
					target: '#MINECRAFT_BOT.MAIN_ACTIVITY.URGENT_NEEDS.EMERGENCY_EATING'
				},
				{
					guard: ({ event }) =>
						event.type === 'START_URGENT_NEEDS' && event.need === 'health',
					actions: ['closeActiveWindowSession'],
					target: '#MINECRAFT_BOT.MAIN_ACTIVITY.URGENT_NEEDS.EMERGENCY_HEALING'
				}
			]
		},
		states: {
			MAIN_ACTIVITY: {
				initial: 'IDLE',
				always: [
					{
						guard: and([
							not(
								stateIn(
									'#MINECRAFT_BOT.MAIN_ACTIVITY.URGENT_NEEDS.EMERGENCY_HEALING'
								)
							),
							({ context }) =>
								context.health > 0 &&
								context.health < context.preferences.healthEmergency
						]),
						target: '.URGENT_NEEDS.EMERGENCY_HEALING'
					},
					{
						guard: and([
							not(stateIn('#MINECRAFT_BOT.MAIN_ACTIVITY.URGENT_NEEDS')),
							({ context }) =>
								context.health > 0 &&
								context.food < context.preferences.foodEmergency &&
								canAttemptRecovery(context) &&
								isRecoverySafe(context)
						]),
						target: '.URGENT_NEEDS.EMERGENCY_EATING'
					},
					{
						guard: and([
							not(stateIn('#MINECRAFT_BOT.MAIN_ACTIVITY.URGENT_NEEDS')),
							not(stateIn('#MINECRAFT_BOT.MAIN_ACTIVITY.OBSERVATION_WAIT')),
							({ context }) =>
								context.health > 0 && context.threatObservationProblem !== null
						]),
						target: '.OBSERVATION_WAIT'
					},
					{
						guard: and([
							not(stateIn('#MINECRAFT_BOT.MAIN_ACTIVITY.URGENT_NEEDS')),
							not(stateIn('#MINECRAFT_BOT.MAIN_ACTIVITY.COMBAT.RETREATING')),
							({ context }) =>
								context.health > 0 &&
								context.threatObservationProblem === null &&
								requiresAvoidance(context)
						]),
						target: '.COMBAT.RETREATING'
					}
				],
				on: {
					UPDATE_HEALTH: {
						guard: ({ context, event }) =>
							event.type === 'UPDATE_HEALTH' &&
							event.health > 0 &&
							event.health < context.preferences.healthEmergency,
						target: '.URGENT_NEEDS.EMERGENCY_HEALING'
					},
					UPDATE_FOOD: {
						guard: canPreemptForHungerRecovery,
						target: '.URGENT_NEEDS.EMERGENCY_EATING'
					}
				},
				states: {
					OBSERVATION_WAIT: {
						entry: ['closeActiveWindowSession', 'ownMovementNone'],
						always: {
							guard: ({ context }) => hasFreshThreatObservation(context),
							target: 'RESUMING'
						},
						on: {
							USER_COMMAND: { actions: 'setGoalFromUserCommand' },
							STOP_CURRENT_GOAL: { actions: 'clearGoal' },
							START_COMBAT: {},
							STOP_COMBAT: {},
							UPDATE_COMBAT_TARGET: { actions: 'updateCombatTarget' }
						}
					},
					IDLE: {
						invoke: {
							id: 'idleGaze',
							src: 'idleGaze',
							input: ({ context }) => ({ bot: context.bot!, options: {} })
						},
						on: {
							IDLE_GAZE_FAILED: { actions: stopChild('idleGaze') },
							UPDATE_COMBAT_TARGET: [
								{
									guard: eventCanAutoEnterCombat,
									actions: [
										'closeActiveWindowSession',
										'updateCombatTarget',
										'setCombatTargetFromObservation'
									],
									target: '#MINECRAFT_BOT.MAIN_ACTIVITY.COMBAT'
								},
								{
									actions: ['updateCombatTarget']
								}
							]
						}
					},
					RESUMING: {
						always: [
							{ guard: 'hasCurrentGoal', target: 'TASKS.THINKING' },
							{ target: 'IDLE' }
						]
					},
					URGENT_NEEDS: {
						entry: ['closeActiveWindowSession'],
						exit: ['ownMovementNone'],
						on: {
							USER_COMMAND: { actions: ['setGoalFromUserCommand'] },
							STOP_CURRENT_GOAL: { actions: ['clearGoal'] },
							START_COMBAT: {},
							STOP_COMBAT: {},
							UPDATE_HEALTH: {},
							UPDATE_FOOD: {},
							START_URGENT_NEEDS: {},
							RECOVERY_FAILED: {
								target: '#MINECRAFT_BOT.MAIN_ACTIVITY.RESUMING',
								actions: ['recordRecoveryFailure', 'notifyThinkingFailure']
							},
							ERROR: {
								target: '#MINECRAFT_BOT.MAIN_ACTIVITY.RESUMING',
								actions: ['recordRecoveryFailure', 'notifyThinkingFailure']
							},
							UPDATE_COMBAT_TARGET: {
								actions: ['updateCombatTarget']
							},
							SURVIVAL_MODE_CHANGED: {
								actions: ['syncSurvivalModeOwner']
							}
						},
						initial: 'EMERGENCY_EATING',
						states: {
							EMERGENCY_EATING: {
								always: {
									guard: ({ context }) =>
										context.health >= context.preferences.healthEmergency &&
										!isHungerRecoverySafe(context),
									target: '#MINECRAFT_BOT.MAIN_ACTIVITY.RESUMING'
								},
								on: {
									UPDATE_HEALTH: {
										guard: ({ context, event }) =>
											event.type === 'UPDATE_HEALTH' &&
											event.health > 0 &&
											event.health < context.preferences.healthEmergency,
										target: 'EMERGENCY_HEALING'
									},
									FOOD_RESTORED: {
										guard: ({ context }) =>
											context.food >= context.preferences.foodRestored &&
											isRecoverySafe(context),
										target: '#MINECRAFT_BOT.MAIN_ACTIVITY.RESUMING',
										actions: ['clearRecoveryFailure']
									},
									RECOVERY_FAILED: [
										{
											guard: ({ context, event }) =>
												event.cause === 'no_food' && isRecoverySafe(context),
											target: '#MINECRAFT_BOT.MAIN_ACTIVITY.RESUMING',
											actions: [
												'recordRecoveryFailure',
												'notifyThinkingFailure'
											]
										},
										{ target: '.RETRYING', actions: ['recordRecoveryFailure'] }
									],
									ERROR: {
										target: '.RETRYING',
										actions: ['recordRecoveryFailure']
									}
								},
								initial: 'RUNNING',
								states: {
									RUNNING: {
										invoke: {
											src: 'emergencyEating',
											input: ({ context }: { context: MachineContext }) => ({
												bot: context.bot!
											}),
											onDone: 'RETRYING',
											onError: {
												target: 'RETRYING',
												actions: ['recordRecoveryFailure']
											}
										}
									},
									RETRYING: { after: { recoveryRetry: 'RUNNING' } }
								}
							},
							EMERGENCY_HEALING: {
								on: {
									HEALTH_RESTORED: {
										guard: ({ context }) =>
											context.health >=
												context.preferences.healthFullyRestored &&
											isRecoverySafe(context),
										target: '#MINECRAFT_BOT.MAIN_ACTIVITY.RESUMING',
										actions: ['clearRecoveryFailure']
									},
									RECOVERY_FAILED: { actions: ['recordRecoveryFailure'] },
									ERROR: {
										target: '.RETRYING',
										actions: ['recordRecoveryFailure']
									}
								},
								initial: 'RUNNING',
								states: {
									RUNNING: {
										invoke: {
											src: 'emergencyHealing',
											input: ({ context }: { context: MachineContext }) => ({
												bot: context.bot!
											}),
											onDone: 'RETRYING',
											onError: {
												target: 'RETRYING',
												actions: ['recordRecoveryFailure']
											}
										}
									},
									RETRYING: { after: { recoveryRetry: 'RUNNING' } }
								}
							}
						}
					},
					COMBAT: {
						always: [
							{
								guard: and([
									not(
										stateIn('#MINECRAFT_BOT.MAIN_ACTIVITY.COMBAT.RETREATING')
									),
									({ context }) =>
										!context.combatTarget.entity || !hasCombatWeapon(context)
								]),
								target: '#MINECRAFT_BOT.MAIN_ACTIVITY.RESUMING',
								actions: 'notifyMissingCombatWeapon'
							},
							{
								guard: and([
									not(
										stateIn('#MINECRAFT_BOT.MAIN_ACTIVITY.COMBAT.RETREATING')
									),
									not(stateIn('#MINECRAFT_BOT.MAIN_ACTIVITY.COMBAT.WAITING')),
									not('canAttack')
								]),
								target: '.WAITING'
							}
						],
						entry: [
							'resetRanged',
							{
								type: 'logStateEntry',
								params: { state: 'MAIN_ACTIVITY.COMBAT' }
							}
						],
						exit: [
							'ownMovementNone',
							{
								type: 'logStateExit',
								params: { state: 'MAIN_ACTIVITY.COMBAT' }
							}
						],
						on: {
							RANGED_UNAVAILABLE: {
								target: '.DECIDING',
								actions: ['disableRanged', 'updateCombatTarget']
							},
							ERROR: {
								target: '.WAITING',
								actions: ['recordCombatFailure', 'blockCombatApproach']
							},
							UPDATE_COMBAT_TARGET: {
								actions: ['updateCombatTarget']
							},
							WEAPON_BROKEN: {
								target: '.DECIDING',
								actions: 'updateCombatTarget'
							},
							ENEMY_BECAME_FAR: {
								target: '.DECIDING',
								actions: 'updateCombatTarget'
							},
							ENEMY_BECAME_CLOSE: {
								target: '.DECIDING',
								actions: 'updateCombatTarget'
							},
							NO_ENEMIES: { target: '.DECIDING', actions: 'updateCombatTarget' }
						},
						initial: 'DECIDING',
						states: {
							WAITING: {
								entry: ['ownMovementNone', 'logCombatWaiting'],
								always: [
									{
										guard: 'canResumeApproach',
										target: 'DECIDING',
										actions: 'resumeCombatApproach'
									},
									{ guard: 'canAttack', target: 'DECIDING' }
								]
							},
							RETREATING: {
								exit: ['ownMovementNone'],
								on: {
									RETREAT_SAFE: {
										guard: ({ context }) =>
											hasFreshThreatObservation(context) &&
											!nearestRetreatCreeper(context),
										target: 'DECIDING',
										actions: 'updateCombatTarget'
									},
									UPDATE_COMBAT_TARGET: { actions: ['updateCombatTarget'] },
									SURVIVAL_MODE_CHANGED: { actions: ['syncSurvivalModeOwner'] },
									NO_ENEMIES: {},
									ENEMY_BECAME_CLOSE: {},
									ENEMY_BECAME_FAR: {},
									WEAPON_BROKEN: {},
									RANGED_UNAVAILABLE: {},
									START_COMBAT: {},
									STOP_COMBAT: {},
									USER_COMMAND: { actions: ['setGoalFromUserCommand'] },
									STOP_CURRENT_GOAL: { actions: ['clearGoal'] },
									ERROR: {
										target: '.RETRYING',
										actions: ['recordCombatFailure']
									}
								},
								initial: 'RUNNING',
								states: {
									RUNNING: {
										invoke: {
											src: 'serviceTacticalRetreat',
											input: ({ context }: { context: MachineContext }) => ({
												bot: context.bot!,
												options: {}
											}),
											onError: 'RETRYING'
										}
									},
									RETRYING: { after: { recoveryRetry: 'RUNNING' } }
								}
							},
							DECIDING: {
								entry: 'notifyMissingCombatWeapon',
								always: [
									{
										guard: ({ context }) =>
											!context.combatTarget.entity || !hasCombatWeapon(context),
										target: '#MINECRAFT_BOT.MAIN_ACTIVITY.RESUMING'
									},
									{
										target: 'MELEE_ATTACKING',
										guard: and(['canMelee', 'isEnemyInMeleeRange'])
									},
									{
										target: 'RANGED_SKIRMISHING',
										guard: 'canSkirmishRanged'
									},
									{
										target: 'MELEE_ATTACKING',
										guard: 'canMelee'
									},
									{ target: 'WAITING' }
								]
							},
							MELEE_ATTACKING: {
								entry: [
									'ownMovementPvp',
									{
										type: 'logStateEntry',
										params: { state: 'MAIN_ACTIVITY.COMBAT.MELEE_ATTACKING' }
									}
								],
								exit: [
									{
										type: 'logStateExit',
										params: { state: 'MAIN_ACTIVITY.COMBAT.MELEE_ATTACKING' }
									}
								],
								on: {
									APPROACH_SAMPLE: { actions: 'recordCombatApproach' },
									APPROACH_ROUTE_FAILED: {
										actions: 'recordApproachRouteFailure'
									},
									UPDATE_COMBAT_TARGET: [
										{
											guard: eventCanSkirmishRangedFromMelee,
											target: 'RANGED_SKIRMISHING',
											actions: ['updateCombatTarget']
										},
										{
											actions: ['updateCombatTarget']
										}
									]
								},
								invoke: {
									src: 'serviceMeleeAttack',
									input: ({ context }: { context: MachineContext }) => ({
										bot: context.bot
									})
								}
							},
							RANGED_SKIRMISHING: {
								entry: [
									'ownMovementNone',
									{
										type: 'logStateEntry',
										params: { state: 'MAIN_ACTIVITY.COMBAT.RANGED_SKIRMISHING' }
									}
								],
								exit: [
									{
										type: 'logStateExit',
										params: { state: 'MAIN_ACTIVITY.COMBAT.RANGED_SKIRMISHING' }
									}
								],
								on: {
									UPDATE_COMBAT_TARGET: [
										{
											guard: eventEnemyInMeleeRange,
											target: 'MELEE_ATTACKING',
											actions: ['updateCombatTarget']
										},
										{
											guard: ({ event, context }) =>
												isCombatTargetUpdateEvent(event) &&
												Boolean(event.combatTarget.entity) &&
												!eventCanSkirmishRanged({ event, context }),
											target: 'MELEE_ATTACKING',
											actions: ['updateCombatTarget']
										},
										{
											actions: ['updateCombatTarget']
										}
									]
								},
								invoke: {
									src: 'serviceRangedSkirmish',
									input: ({ context }: { context: MachineContext }) => ({
										bot: context.bot
									})
								}
							}
						}
					},
					TASKS: {
						entry: ['markTaskActive'],
						exit: ['markTaskInactive'],
						on: {
							UPDATE_COMBAT_TARGET: [
								{
									guard: eventCanAutoEnterCombat,
									actions: [
										'closeActiveWindowSession',
										'updateCombatTarget',
										'setCombatTargetFromObservation'
									],
									target: '#MINECRAFT_BOT.MAIN_ACTIVITY.COMBAT'
								},
								{
									actions: ['updateCombatTarget']
								}
							]
						},
						initial: 'IDLE',
						states: {
							IDLE: {},
							THINKING: {
								always: {
									guard: 'isAgentLoopStuck',
									target: 'DECIDE_NEXT'
								},
								entry: ['logThinkingStart'],
								invoke: {
									src: 'agentThinking',
									input: ({ context }: { context: MachineContext }) => ({
										bot: context.bot!,
										context
									}),
									onDone: [
										{
											guard: 'thinkingProducedInvalidExecution',
											target: 'DECIDE_NEXT',
											actions: ['storeThinkingFailure']
										},
										{
											guard: 'thinkingProducedRejection',
											target: 'DECIDE_NEXT',
											actions: ['storeThinkingFailure']
										},
										{
											guard: 'thinkingProducedExecution',
											target: 'EXECUTING',
											actions: [
												'logThinkingExecution',
												'storeThinkingExecution'
											]
										},
										{
											guard: 'thinkingProducedFinish',
											target: '#MINECRAFT_BOT.MAIN_ACTIVITY.IDLE',
											actions: [
												'closeActiveWindowSession',
												'logThinkingFinish',
												'appendFinishConversationEntry',
												'notifyGoalFinished',
												'clearGoal'
											]
										},
										{
											target: '#MINECRAFT_BOT.MAIN_ACTIVITY.IDLE',
											actions: [
												'closeActiveWindowSession',
												'logThinkingFailure',
												'storeThinkingFailure',
												'appendFailureConversationEntry',
												'notifyThinkingFailure',
												'clearGoal'
											]
										}
									],
									onError: {
										target: '#MINECRAFT_BOT.MAIN_ACTIVITY.IDLE',
										actions: [
											'closeActiveWindowSession',
											'logThinkingError',
											'clearGoal'
										]
									}
								}
							},
							EXECUTING: {
								initial: 'RESOLVE',
								states: {
									RESOLVE: {
										always: [
											{
												guard: 'isMiningExecution',
												target: 'MINING',
												actions: [
													assign({
														taskData: ({ context }) =>
															({
																blockName: requireMiningExecution(context)
																	.block_name.trim()
																	.toLowerCase(),
																count: requireMiningExecution(context).count,
																targetBlocks: [],
																targetIndex: 0,
																collected: 0,
																navigationAttempts: 0,
																breakAttempts: 0
															}) satisfies MiningTaskData
													})
												]
											},
											{ guard: 'isNavigateExecution', target: 'NAVIGATING' },
											{ guard: 'isBreakExecution', target: 'BREAKING' },
											{ guard: 'isOpenWindowExecution', target: 'OPEN_WINDOW' },
											{
												guard: 'isTransferItemExecution',
												target: 'TRANSFER_ITEM'
											},
											{
												guard: 'isCloseWindowExecution',
												target: 'CLOSE_WINDOW'
											},
											{ guard: 'isPlaceExecution', target: 'PLACING' },
											{ guard: 'isFollowExecution', target: 'FOLLOWING' },
											{
												target:
													'#MINECRAFT_BOT.MAIN_ACTIVITY.TASKS.DECIDE_NEXT',
												actions: ['recordExecutionFailure']
											}
										]
									},
									MINING: {
										initial: 'CHECKING_PRECONDITIONS',
										entry: ['entryMining'],
										exit: ['exitMining'],
										states: {
											CHECKING_PRECONDITIONS: {
												always: [
													{
														guard: 'canAttemptMining',
														target: 'SEARCHING'
													},
													{
														target: 'TASK_FAILED'
													}
												]
											},
											SEARCHING: {
												invoke: {
													src: primitiveSearchBlock,
													input: ({ context }: { context: MachineContext }) => {
														const taskData = context.taskData as MiningTaskData
														return {
															bot: context.bot!,
															options: {
																blockName: taskData.blockName,
																count: taskData.count,
																maxDistance: 64,
																mode: 'mining' as const,
																maxYDiffAbove: 6,
																maxYDiffBelow: 2,
																prioritizeSafety: true
															}
														}
													}
												},
												on: {
													BLOCKS_FOUND: {
														target: 'CHECKING_DISTANCE',
														actions: ['storeFoundBlocks']
													},
													NOT_FOUND: 'TASK_FAILED',
													ERROR: 'TASK_FAILED'
												}
											},
											CHECKING_DISTANCE: {
												always: [
													{
														guard: 'isBlockNearby',
														target: 'BREAKING'
													},
													{
														target: 'NAVIGATING'
													}
												]
											},
											NAVIGATING: {
												invoke: {
													src: primitiveNavigating,
													input: ({ context }: { context: MachineContext }) => {
														const taskData = context.taskData as MiningTaskData
														const targetBlock =
															taskData.targetBlocks[taskData.targetIndex]
														return {
															bot: context.bot!,
															options: {
																target: targetBlock?.position
															}
														}
													}
												},
												on: {
													ARRIVED: {
														target: 'BREAKING'
													},
													NAVIGATION_FAILED: [
														{
															guard: 'maxNavigationAttemptsReached',
															target: 'TASK_FAILED'
														},
														{
															target: 'SEARCHING',
															actions: ['incrementNavigationAttempts']
														}
													],
													ERROR: 'TASK_FAILED'
												}
											},
											BREAKING: {
												invoke: {
													src: primitiveBreaking,
													input: ({ context }: { context: MachineContext }) => {
														const taskData = context.taskData as MiningTaskData
														return {
															bot: context.bot!,
															options: {
																block:
																	taskData.targetBlocks[taskData.targetIndex]
															}
														}
													}
												},
												on: {
													BROKEN: {
														target: 'CHECKING_GOAL',
														actions: [
															'incrementCollected',
															'resetNavigationAttempts',
															'resetBreakAttempts'
														]
													},
													BREAKING_FAILED: [
														{
															guard: 'maxBreakAttemptsReached',
															target: 'TASK_FAILED'
														},
														{
															target: 'SEARCHING',
															actions: ['incrementBreakAttempts']
														}
													],
													ERROR: 'TASK_FAILED'
												}
											},
											CHECKING_GOAL: {
												always: [
													{
														guard: 'isMiningGoalComplete',
														target: 'TASK_COMPLETED'
													},
													{
														guard: 'isInventoryFull',
														target: 'TASK_FAILED'
													},
													{
														guard: 'hasMoreBlocksToMine',
														target: 'NAVIGATING',
														actions: ['advanceToNextBlock']
													},
													{
														target: 'SEARCHING'
													}
												]
											},
											TASK_COMPLETED: {
												entry: [
													'taskMiningCompleted',
													'recordExecutionSuccess',
													assign({ taskData: () => null })
												],
												always: '#MINECRAFT_BOT.MAIN_ACTIVITY.TASKS.DECIDE_NEXT'
											},
											TASK_FAILED: {
												entry: [
													'taskMiningFailed',
													'recordExecutionFailure',
													assign({ taskData: () => null })
												],
												always: '#MINECRAFT_BOT.MAIN_ACTIVITY.TASKS.DECIDE_NEXT'
											}
										}
									},
									NAVIGATING: {
										invoke: {
											src: primitiveNavigating,
											input: ({ context }: { context: MachineContext }) =>
												resolveExecutionInput(context)
										},
										on: {
											ARRIVED: {
												target:
													'#MINECRAFT_BOT.MAIN_ACTIVITY.TASKS.DECIDE_NEXT',
												actions: ['recordExecutionSuccess']
											},
											NAVIGATION_FAILED: {
												target:
													'#MINECRAFT_BOT.MAIN_ACTIVITY.TASKS.DECIDE_NEXT',
												actions: ['recordExecutionFailure']
											},
											ERROR: {
												target:
													'#MINECRAFT_BOT.MAIN_ACTIVITY.TASKS.DECIDE_NEXT',
												actions: ['recordExecutionFailure']
											}
										}
									},
									BREAKING: {
										invoke: {
											src: primitiveBreaking,
											input: ({ context }: { context: MachineContext }) =>
												resolveExecutionInput(context)
										},
										on: {
											BROKEN: {
												target:
													'#MINECRAFT_BOT.MAIN_ACTIVITY.TASKS.DECIDE_NEXT',
												actions: ['recordExecutionSuccess']
											},
											BREAKING_FAILED: {
												target:
													'#MINECRAFT_BOT.MAIN_ACTIVITY.TASKS.DECIDE_NEXT',
												actions: ['recordExecutionFailure']
											},
											ERROR: {
												target:
													'#MINECRAFT_BOT.MAIN_ACTIVITY.TASKS.DECIDE_NEXT',
												actions: ['recordExecutionFailure']
											}
										}
									},
									OPEN_WINDOW: {
										invoke: {
											src: primitiveOpenWindow,
											input: ({ context }: { context: MachineContext }) =>
												resolveExecutionInput(context)
										},
										on: {
											WINDOW_OPENED: {
												target:
													'#MINECRAFT_BOT.MAIN_ACTIVITY.TASKS.DECIDE_NEXT',
												actions: ['recordExecutionSuccess']
											},
											WINDOW_OPEN_FAILED: {
												target:
													'#MINECRAFT_BOT.MAIN_ACTIVITY.TASKS.DECIDE_NEXT',
												actions: ['recordExecutionFailure']
											},
											ERROR: {
												target:
													'#MINECRAFT_BOT.MAIN_ACTIVITY.TASKS.DECIDE_NEXT',
												actions: ['recordExecutionFailure']
											}
										}
									},
									TRANSFER_ITEM: {
										invoke: {
											src: primitiveTransferItem,
											input: ({ context }: { context: MachineContext }) =>
												resolveExecutionInput(context)
										},
										on: {
											WINDOW_ITEM_TRANSFERRED: {
												target:
													'#MINECRAFT_BOT.MAIN_ACTIVITY.TASKS.DECIDE_NEXT',
												actions: ['recordExecutionSuccess']
											},
											WINDOW_TRANSFER_FAILED: {
												target:
													'#MINECRAFT_BOT.MAIN_ACTIVITY.TASKS.DECIDE_NEXT',
												actions: ['recordExecutionFailure']
											},
											ERROR: {
												target:
													'#MINECRAFT_BOT.MAIN_ACTIVITY.TASKS.DECIDE_NEXT',
												actions: ['recordExecutionFailure']
											}
										}
									},
									CLOSE_WINDOW: {
										invoke: {
											src: primitiveCloseWindow,
											input: ({ context }: { context: MachineContext }) =>
												resolveExecutionInput(context)
										},
										on: {
											WINDOW_CLOSED: {
												target:
													'#MINECRAFT_BOT.MAIN_ACTIVITY.TASKS.DECIDE_NEXT',
												actions: ['recordExecutionSuccess']
											},
											WINDOW_CLOSE_FAILED: {
												target:
													'#MINECRAFT_BOT.MAIN_ACTIVITY.TASKS.DECIDE_NEXT',
												actions: ['recordExecutionFailure']
											},
											ERROR: {
												target:
													'#MINECRAFT_BOT.MAIN_ACTIVITY.TASKS.DECIDE_NEXT',
												actions: ['recordExecutionFailure']
											}
										}
									},
									PLACING: {
										invoke: {
											src: primitivePlacing,
											input: ({ context }: { context: MachineContext }) =>
												resolveExecutionInput(context)
										},
										on: {
											PLACED: {
												target:
													'#MINECRAFT_BOT.MAIN_ACTIVITY.TASKS.DECIDE_NEXT',
												actions: ['recordExecutionSuccess']
											},
											PLACING_FAILED: {
												target:
													'#MINECRAFT_BOT.MAIN_ACTIVITY.TASKS.DECIDE_NEXT',
												actions: ['recordExecutionFailure']
											},
											ERROR: {
												target:
													'#MINECRAFT_BOT.MAIN_ACTIVITY.TASKS.DECIDE_NEXT',
												actions: ['recordExecutionFailure']
											}
										}
									},
									FOLLOWING: {
										invoke: {
											src: primitiveFollowing,
											input: ({ context }: { context: MachineContext }) =>
												resolveExecutionInput(context)
										},
										on: {
											FOLLOWING_STOPPED: {
												target:
													'#MINECRAFT_BOT.MAIN_ACTIVITY.TASKS.DECIDE_NEXT',
												actions: ['recordExecutionSuccess']
											},
											FOLLOWING_FAILED: {
												target:
													'#MINECRAFT_BOT.MAIN_ACTIVITY.TASKS.DECIDE_NEXT',
												actions: ['recordExecutionFailure']
											},
											ERROR: {
												target:
													'#MINECRAFT_BOT.MAIN_ACTIVITY.TASKS.DECIDE_NEXT',
												actions: ['recordExecutionFailure']
											}
										}
									}
								}
							},
							DECIDE_NEXT: {
								always: [
									{
										guard: 'isAgentLoopStuck',
										target: '#MINECRAFT_BOT.MAIN_ACTIVITY.IDLE',
										actions: [
											'closeActiveWindowSession',
											'notifyLoopAbort',
											'clearGoal'
										]
									},
									{
										guard: 'hasCurrentGoal',
										target: 'THINKING'
									},
									{
										target: '#MINECRAFT_BOT.MAIN_ACTIVITY.IDLE'
									}
								]
							}
						}
					}
				}
			},
			MONITORING: {
				type: 'parallel',
				states: {
					HEALTH_MONITOR: {
						on: { UPDATE_HEALTH: { actions: ['updateHealth'] } }
					},
					HUNGER_MONITOR: { on: { UPDATE_FOOD: { actions: ['updateFood'] } } },
					ENTITIES_MONITOR: {
						initial: 'RUNNING',
						on: {
							THREAT_OBSERVATION_FAILED: {
								target: '.RETRYING',
								actions: 'invalidateFailedThreatObservation'
							},
							UPDATE_ENTITIES: { actions: ['updateEntities'] },
							REMOVE_ENTITY: {
								actions: ['removeEntity']
							},
							ENTITY_DIED: { actions: 'removeEntity' }
						},
						states: {
							RUNNING: {
								invoke: {
									src: 'serviceEntitiesTracking',
									input: ({ context }: { context: MachineContext }) => ({
										bot: context.bot
									}),
									onError: {
										target: 'RETRYING',
										actions: 'invalidateFailedThreatObservation'
									}
								}
							},
							RETRYING: { after: { recoveryRetry: 'RUNNING' } }
						}
					}
				}
			}
		}
	})
}

export const machine = createBotMachine()
