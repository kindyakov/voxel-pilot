import { type AgentTurnResult, runAgentTurn } from '@/ai/loop.js'
import {
	appendRejectedStepSignature,
	appendTaskFact,
	createTaskContext,
	getTaskFactFromExecution,
	refreshTaskContext
} from '@/ai/taskContext.js'
import type { PendingExecution } from '@/ai/tools.js'
import { Vec3 as Vec3Class } from 'vec3'
import { assign, fromPromise, setup } from 'xstate'

import type { Bot, Entity } from '@/types'

import combatActors from '@/hsm/actors/combat.actors'
import monitoringActors from '@/hsm/actors/monitoring.actors'
import { closeWindowSession } from '@/ai/runtime/window.js'
import { primitiveCloseWindow } from '@/hsm/actors/primitives/primitiveCloseWindow.primitive'
import { primitiveBreaking } from '@/hsm/actors/primitives/primitiveBreaking.primitive'
import { primitiveFollowing } from '@/hsm/actors/primitives/primitiveFollowing.primitive'
import { primitiveNavigating } from '@/hsm/actors/primitives/primitiveNavigating.primitive'
import { primitiveOpenWindow } from '@/hsm/actors/primitives/primitiveOpenWindow.primitive'
import { primitivePlacing } from '@/hsm/actors/primitives/primitivePlacing.primitive'
import { primitiveTransferItem } from '@/hsm/actors/primitives/primitiveTransferItem.primitive'
import { type MachineContext, context } from '@/hsm/context'
import combatGuards from '@/hsm/guards/combat.guards'
import type { MachineEvent } from '@/hsm/types'

import { canSeeEnemy } from '@/utils/combat/enemyVisibility'
import { hasMovementController } from '@/utils/combat/movementController'

const waitWithSignal = (ms: number, signal: AbortSignal): Promise<void> =>
	new Promise((resolve, reject) => {
		const timeout = setTimeout(() => {
			signal.removeEventListener('abort', onAbort)
			resolve()
		}, ms)

		const onAbort = () => {
			clearTimeout(timeout)
			reject(new Error('Aborted'))
		}

		signal.addEventListener('abort', onAbort, { once: true })
	})

const createRecoveryActor = (mode: 'food' | 'health') =>
	fromPromise<void, { bot: Bot; threshold: number }>(
		async ({ input, signal }) => {
			for (let attempt = 0; attempt < 8; attempt += 1) {
				if (signal.aborted) {
					throw new Error('Aborted')
				}

				if (mode === 'food' && input.bot.food >= input.threshold) {
					return
				}

				if (mode === 'health' && input.bot.health >= input.threshold) {
					return
				}

				if (input.bot.utils.getAllFood().length === 0) {
					throw new Error('No food available for recovery')
				}

				await input.bot.utils.eating()
				await waitWithSignal(1000, signal)
			}

			throw new Error(
				mode === 'food'
					? 'Emergency eating did not restore hunger in time'
					: 'Emergency healing did not restore health in time'
			)
		}
	)

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
		lastAction: input.context.lastAction,
		lastResult: input.context.lastResult,
		lastReason: input.context.lastReason,
		errorHistory: input.context.errorHistory,
		taskContext: input.context.taskContext,
		activeWindowSession: input.context.activeWindowSession,
		activeWindowSessionState: input.context.activeWindowSessionState,
		signal
	})
})

const fallbackExecutionActor = fromPromise(async () => {
	throw new Error('Unsupported execution tool')
})

const isRecord = (value: unknown): value is Record<string, unknown> =>
	Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const normalizeEntitySelector = (value: unknown): string | null => {
	if (typeof value !== 'string') {
		return null
	}

	const normalized = value.trim().toLowerCase()
	return normalized.length > 0 ? normalized : null
}

const tryGetPositionArg = (
	execution: PendingExecution,
	key: string
): Vec3Class | null => {
	const raw = execution.args[key]
	if (!isRecord(raw)) {
		return null
	}

	const { x, y, z } = raw
	if (
		typeof x !== 'number' ||
		!Number.isFinite(x) ||
		typeof y !== 'number' ||
		!Number.isFinite(y) ||
		typeof z !== 'number' ||
		!Number.isFinite(z)
	) {
		return null
	}

	return new Vec3Class(x, y, z)
}

const toFailureSignature = (
	execution: PendingExecution | null,
	reason: string | null
): string | null => {
	if (!execution || !reason) {
		return null
	}

	const orderedArgs = Object.keys(execution.args)
		.sort()
		.reduce<Record<string, unknown>>((acc, key) => {
			acc[key] = execution.args[key]
			return acc
		}, {})

	return `${execution.toolName}:${JSON.stringify(orderedArgs)}:${reason}`
}

const tryCloseActiveWindowSession = (context: MachineContext): boolean => {
	const session = context.activeWindowSession
	if (!session || !context.bot) {
		return false
	}

	try {
		closeWindowSession(context.bot, session)
		return true
	} catch (error) {
		console.error(
			'[HSM] failed to close active window session',
			error instanceof Error ? error.message : String(error)
		)
		return false
	}
}

const resolveExecutionActor = (context: MachineContext) => {
	switch (context.pendingExecution?.toolName) {
		case 'navigate_to':
			return primitiveNavigating
		case 'break_block':
			return primitiveBreaking
		case 'open_window':
			return primitiveOpenWindow
		case 'transfer_item':
			return primitiveTransferItem
		case 'close_window':
			return primitiveCloseWindow
		case 'place_block':
			return primitivePlacing
		case 'follow_entity':
			return primitiveFollowing
		default:
			return fallbackExecutionActor
	}
}

const resolveExecutionInput = (context: MachineContext) => {
	const bot = context.bot
	const execution = context.pendingExecution

	if (!bot || !execution) {
		return {
			bot: bot as Bot,
			options: {}
		}
	}

	switch (execution.toolName) {
		case 'navigate_to':
			return {
				bot,
				options: {
					target: tryGetPositionArg(execution, 'position') as any,
					range:
						typeof execution.args.range === 'number'
							? execution.args.range
							: undefined
				}
			}
		case 'break_block': {
			const targetPosition = tryGetPositionArg(execution, 'position')
			const block = targetPosition ? bot.blockAt(targetPosition) : null
			return {
				bot,
				options: {
					block: block as any
				}
			}
		}
		case 'open_window':
			return {
				bot,
				options: {
					position: tryGetPositionArg(execution, 'position') as any
				}
			}
		case 'transfer_item':
			return {
				bot,
				options: {
					sourceZone: String(execution.args.source_zone ?? ''),
					destZone: String(execution.args.dest_zone ?? ''),
					itemName: String(execution.args.item_name ?? ''),
					count:
						typeof execution.args.count === 'number'
							? execution.args.count
							: undefined
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
					blockName: String(execution.args.block_name ?? ''),
					position: tryGetPositionArg(execution, 'position') as any,
					faceVector:
						execution.args.face_vector &&
						typeof execution.args.face_vector === 'object'
							? (tryGetPositionArg(execution, 'face_vector') as any)
							: undefined
				}
			}
		case 'follow_entity': {
			const requestedName = normalizeEntitySelector(execution.args.entity_name)
			const requestedType = normalizeEntitySelector(execution.args.entity_type)
			const maxDistance =
				typeof execution.args.max_distance === 'number'
					? execution.args.max_distance
					: Number.POSITIVE_INFINITY
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

				return Boolean(requestedName || requestedType) && matchesName && matchesType
			})
			return {
				bot,
				options: {
					target: target as any,
					distance:
						typeof execution.args.distance === 'number'
							? execution.args.distance
							: undefined
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

const isEntityUpdateEvent = (
	event: MachineEvent
): event is Extract<MachineEvent, { type: 'UPDATE_ENTITIES' }> =>
	event.type === 'UPDATE_ENTITIES'

const eventCanAutoEnterCombat = ({
	context,
	event
}: {
	context: MachineContext
	event: MachineEvent
}) =>
	isEntityUpdateEvent(event) &&
	context.preferences.autoDefend &&
	!context.combatStopRequested &&
	Boolean(event.nearestEnemy.entity)

const eventEnemyInMeleeRange = ({
	event,
	context
}: {
	context: MachineContext
	event: MachineEvent
}) =>
	isEntityUpdateEvent(event) &&
	Boolean(event.nearestEnemy.entity) &&
	event.nearestEnemy.distance <= context.preferences.enemyMeleeRange

const eventCanSkirmishRanged = ({
	event,
	context
}: {
	context: MachineContext
	event: MachineEvent
}) => {
	if (
		!isEntityUpdateEvent(event) ||
		!event.nearestEnemy.entity ||
		event.nearestEnemy.distance <= context.preferences.enemyMeleeRange
	) {
		return false
	}

	const weapon = context.bot?.utils.getRangeWeapon()
	const arrows = context.bot?.utils.getArrow()

	return Boolean(weapon && arrows && context.bot) &&
		canSeeEnemy(context.bot!, event.nearestEnemy.entity)
}

interface MachineFactoryOptions {
	thinkingActor?: any
	actors?: Record<string, any>
}

export const createBotMachine = (options?: MachineFactoryOptions) => {
	const actorOverrides = options?.actors ?? {}

	return setup({
		types: {} as {
			context: MachineContext
			events: MachineEvent
			input: { bot: Bot }
		},
		actors: {
			agentThinking:
				actorOverrides.agentThinkingTurn ??
				options?.thinkingActor ??
				defaultThinkingActor,
			emergencyEating:
				actorOverrides.serviceEmergencyEating ?? createRecoveryActor('food'),
			emergencyHealing:
				actorOverrides.serviceEmergencyHealing ?? createRecoveryActor('health'),
			serviceEntitiesTracking:
				actorOverrides.serviceEntitiesTracking ??
				monitoringActors.serviceEntitiesTracking,
			serviceApproaching:
				actorOverrides.serviceApproaching ?? combatActors.serviceApproaching,
			serviceFleeing:
				actorOverrides.serviceFleeing ?? combatActors.serviceFleeing,
			serviceMeleeAttack:
				actorOverrides.serviceMeleeAttack ?? combatActors.serviceMeleeAttack,
			serviceRangedSkirmish:
				actorOverrides.serviceRangedSkirmish ??
				actorOverrides.serviceRangedAttack ??
				combatActors.serviceRangedSkirmish
		},
		guards: {
			...combatGuards,
			hasCurrentGoal: ({ context }) => Boolean(context.currentGoal),
			isHealthCritical: ({ context }) =>
				context.health < context.preferences.healthEmergency,
			isHungerCritical: ({ context }) =>
				context.food < context.preferences.foodEmergency,
			isEnemyNearby: ({ context }) => context.nearestEnemy.entity !== null,
			isAgentLoopStuck: ({ context }) => context.failureRepeats >= 3,
			thinkingProducedExecution: ({ event }: any) =>
				event.output?.kind === 'execute',
			thinkingProducedFinish: ({ event }: any) =>
				event.output?.kind === 'finish',
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
				context.pendingExecution?.toolName === 'follow_entity'
		},
		actions: {
			logStateEntry: ({ context, event }, params: { state: string }) => {
				console.log(
					`[HSM] enter ${params.state}`,
					JSON.stringify({
						event: event.type,
						targetId: context.nearestEnemy.entity?.id ?? null,
						distance:
							Number.isFinite(context.nearestEnemy.distance)
								? Number(context.nearestEnemy.distance.toFixed(2))
								: null
					})
				)
			},
			logStateExit: ({ context, event }, params: { state: string }) => {
				console.log(
					`[HSM] exit ${params.state}`,
					JSON.stringify({
						event: event.type,
						targetId: context.nearestEnemy.entity?.id ?? null,
						distance:
							Number.isFinite(context.nearestEnemy.distance)
								? Number(context.nearestEnemy.distance.toFixed(2))
								: null
					})
				)
			},
			logThinkingStart: ({ context }) => {
				console.log(
					'[AI] thinking_start',
					JSON.stringify({
						goal: context.currentGoal,
						subGoal: context.subGoal,
						lastAction: context.lastAction,
						lastResult: context.lastResult
					})
				)
			},
			logThinkingExecution: ({ event }) => {
				const output = (event as any).output as AgentTurnResult
				if (output.kind !== 'execute') {
					return
				}

				console.log(
					'[AI] thinking_done',
					JSON.stringify({
						kind: output.kind,
						toolName: output.execution.toolName,
						args: output.execution.args,
						subGoal: output.subGoal
					})
				)
			},
			logThinkingFinish: ({ event }) => {
				const output = (event as any).output as AgentTurnResult
				if (output.kind !== 'finish') {
					return
				}

				console.log(
					'[AI] thinking_done',
					JSON.stringify({
						kind: output.kind,
						message: output.message
					})
				)
			},
			logThinkingFailure: ({ event }) => {
				const output = (event as any).output as AgentTurnResult
				if (output.kind !== 'failed') {
					return
				}

				console.log(
					'[AI] thinking_done',
					JSON.stringify({
						kind: output.kind,
						reason: output.reason,
						transcript: output.transcript
					})
				)
			},
			logThinkingError: ({ event }) => {
				const error =
					(event as { error?: unknown }).error ?? 'Unknown thinking error'
				console.log(
					'[AI] thinking_error',
					JSON.stringify({
						error: error instanceof Error ? error.message : String(error)
					})
				)
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
				health: ({ context, event }) => {
					if (event.type !== 'UPDATE_HEALTH') {
						return 20
					}

					console.log(
						`[HSM] health ${context.health} -> ${event.health}`,
						JSON.stringify({
							event: event.type
						})
					)

					return event.health
				}
			}),
			updateFood: assign({
				food: ({ context, event }) => {
					if (event.type !== 'UPDATE_FOOD') {
						return 20
					}

					console.log(
						`[HSM] food ${context.food} -> ${event.food}`,
						JSON.stringify({
							event: event.type
						})
					)

					return event.food
				}
			}),
			updateOxygen: assign({
				oxygenLevel: ({ event }) =>
					event.type === 'UPDATE_OXYGEN' ? event.oxygenLevel : 20
			}),
			updateEntities: assign({
				entities: ({ event }) =>
					event.type === 'UPDATE_ENTITIES' ? event.entities : [],
				enemies: ({ event }) =>
					event.type === 'UPDATE_ENTITIES' ? event.enemies : [],
				players: ({ event }) =>
					event.type === 'UPDATE_ENTITIES' ? event.players : [],
				nearestEnemy: ({ context, event }) => {
					if (event.type !== 'UPDATE_ENTITIES') {
						return { entity: null, distance: Infinity }
					}

					const preferredTarget =
						context.preferredCombatTargetId === null
							? null
							: ([...event.entities, ...event.enemies, ...event.players].find(
									entity => entity.id === context.preferredCombatTargetId
								) ?? null)

					if (!preferredTarget) {
						return event.nearestEnemy
					}

					return {
						entity: preferredTarget,
						distance:
							context.bot?.entity?.position?.distanceTo(
								preferredTarget.position
							) ?? event.nearestEnemy.distance
					}
				},
				combatStopRequested: ({ context, event }) =>
					event.type === 'UPDATE_ENTITIES'
						? context.combatStopRequested && Boolean(event.nearestEnemy.entity)
						: false
			}),
			removeEntity: assign(({ context, event }) => {
				if (event.type !== 'REMOVE_ENTITY') {
					return {}
				}

				return {
					entities: context.entities.filter(
						entity => entity.id !== event.entity.id
					),
					enemies: context.enemies.filter(
						entity => entity.id !== event.entity.id
					),
					players: context.players.filter(
						entity => entity.id !== event.entity.id
					),
					nearestEnemy:
						context.nearestEnemy.entity?.id === event.entity.id
							? { entity: null, distance: Infinity }
							: context.nearestEnemy,
					preferredCombatTargetId:
						context.preferredCombatTargetId === event.entity.id
							? null
							: context.preferredCombatTargetId,
					combatStopRequested:
						context.nearestEnemy.entity?.id === event.entity.id
							? false
							: context.combatStopRequested
				}
			}),
			updateAfterDeath: assign({
				entities: [],
				enemies: [],
				players: [],
				inventory: [],
				nearestEnemy: {
					entity: null,
					distance: Infinity
				},
				movementOwner: 'NONE',
				currentGoal: null,
				subGoal: null,
				taskContext: createTaskContext(null, null),
				pendingExecution: null,
				activeWindowSession: null,
				activeWindowSessionState: null,
				lastToolTranscript: [],
				preferredCombatTargetId: null,
				combatStopRequested: false
			}),
			markTaskActive: assign({
				isActiveTask: true
			}),
			markTaskInactive: assign({
				isActiveTask: false,
				pendingExecution: null
			}),
			setGoalFromUserCommand: assign(({ event }) => {
				if (event.type !== 'USER_COMMAND') {
					return {}
				}

				return {
					currentGoal: event.text,
					subGoal: null,
					taskContext: createTaskContext(event.text, null),
					pendingExecution: null,
					lastToolTranscript: [],
					failureSignature: null,
					failureRepeats: 0,
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
					failureSignature: null,
					failureRepeats: 0,
					movementOwner: 'NONE',
					preferredCombatTargetId: null,
					combatStopRequested: false
				}
			}),
			markWindowCloseFailed: assign(({ context }) => {
				if (!context.activeWindowSession) {
					return {
						activeWindowSessionState: null
					}
				}

				return {
					activeWindowSessionState: 'close_failed'
				}
			}),
			closeActiveWindowSession: assign(({ context }) => {
				const closed = tryCloseActiveWindowSession(context)

				if (!context.activeWindowSession) {
					return {
						activeWindowSessionState: null
					}
				}

				return closed
					? {
							activeWindowSession: null,
							activeWindowSessionState: null
						}
					: {
							activeWindowSessionState: 'close_failed'
						}
			}),
			storeWindowSession: assign(({ event }) => {
				if (event.type !== 'WINDOW_OPENED') {
					return {}
				}

				return {
					activeWindowSession: event.session,
					activeWindowSessionState: 'open'
				}
			}),
			clearWindowSession: assign({
				activeWindowSession: null,
				activeWindowSessionState: null
			}),
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
					nearestEnemy: {
						entity: event.target,
						distance:
							context.bot?.entity?.position?.distanceTo(
								event.target.position
							) ?? context.nearestEnemy.distance
					}
				}
			}),
			suppressCombatAutoEntry: assign({
				combatStopRequested: true
			}),
			clearCombatTarget: assign({
				movementOwner: 'NONE',
				preferredCombatTargetId: null,
				nearestEnemy: { entity: null, distance: Infinity }
			}),
			ownMovementNone: assign({
				movementOwner: 'NONE'
			}),
			ownMovementPathfinder: assign({
				movementOwner: 'PATHFINDER'
			}),
			ownMovementPvp: assign({
				movementOwner: 'PVP'
			}),
			ownMovementMicro: assign({
				movementOwner: ({ context }) =>
					hasMovementController(context.bot) ? 'MOVEMENT' : 'NONE'
			}),
			storeThinkingExecution: assign(({ context, event }) => {
				const output = (event as any).output as AgentTurnResult
				if (output.kind !== 'execute') {
					return {}
				}

				return {
					pendingExecution: output.execution,
					subGoal: output.subGoal,
					lastToolTranscript: output.transcript,
					taskContext: refreshTaskContext(
						context.taskContext,
						context.currentGoal,
						output.subGoal
					)
				}
			}),
			storeThinkingFailure: assign(({ context, event }) => {
				const output = (event as any).output as AgentTurnResult
				if (output.kind !== 'failed') {
					return {}
				}

				return {
					lastResult: 'FAILED' as const,
					lastReason: output.reason,
					lastToolTranscript: output.transcript,
					pendingExecution: null,
					taskContext: appendRejectedStepSignature(
						context.taskContext,
						toFailureSignature(
							context.pendingExecution,
							output.reason
						) ?? `thinking_failed:${output.reason}`
					)
				}
			}),
			recordExecutionSuccess: assign(({ context, event }) => ({
				lastAction: context.pendingExecution?.toolName ?? context.lastAction,
				lastActionArgs:
					context.pendingExecution?.args ?? context.lastActionArgs,
				lastResult: 'SUCCESS' as const,
				lastReason: null,
				pendingExecution: null,
				failureSignature: null,
				failureRepeats: 0,
				lastToolTranscript: [event.type],
				taskContext: appendTaskFact(
					refreshTaskContext(
						context.taskContext,
						context.currentGoal,
						context.subGoal
					),
					getTaskFactFromExecution(
						context.pendingExecution?.toolName ?? null,
						context.pendingExecution?.args ?? null,
						'SUCCESS',
						null
					)
				)
			})),
			recordExecutionFailure: assign(({ context, event }) => {
				const reason =
					'reason' in event && typeof event.reason === 'string'
						? event.reason
						: event.type === 'ERROR'
							? event.error
							: 'Unknown execution failure'
				const signature = toFailureSignature(context.pendingExecution, reason)
				const repeats =
					signature && context.failureSignature === signature
						? context.failureRepeats + 1
						: 1

				return {
					lastAction: context.pendingExecution?.toolName ?? context.lastAction,
					lastActionArgs:
						context.pendingExecution?.args ?? context.lastActionArgs,
					lastResult: 'FAILED' as const,
					lastReason: reason,
					pendingExecution: null,
					failureSignature: signature,
					failureRepeats: repeats,
					errorHistory: [...context.errorHistory, reason].slice(-3),
					lastToolTranscript: [event.type],
					taskContext: appendTaskFact(
						appendRejectedStepSignature(
							refreshTaskContext(
								context.taskContext,
								context.currentGoal,
								context.subGoal
							),
							signature ?? `execution_failed:${reason}`
						),
						getTaskFactFromExecution(
							context.pendingExecution?.toolName ?? null,
							context.pendingExecution?.args ?? null,
							'FAILED',
							reason
						)
					)
				}
			}),
			notifyGoalFinished: ({ context, event }) => {
				const output = (event as any).output as AgentTurnResult
				if (output.kind === 'finish') {
					context.bot?.chat(output.message)
				}
			},
			notifyThinkingFailure: ({ context }) => {
				if (context.lastReason) {
					context.bot?.chat(`Не могу продолжить задачу: ${context.lastReason}`)
				}
			},
			notifyLoopAbort: ({ context }) => {
				if (!context.lastAction || !context.lastReason) {
					context.bot?.chat(
						'Я застрял и останавливаю текущую задачу. Жду указаний.'
					)
					return
				}

				context.bot?.chat(
					`Я не могу выполнить задачу: ${context.lastAction} завершился ошибкой "${context.lastReason}" несколько раз подряд. Жду указаний.`
				)
			}
		}
	}).createMachine({
		id: 'MINECRAFT_BOT',
		type: 'parallel',
		context: ({ input }) => ({
			...context,
			bot: input.bot
		}),
		on: {
			UPDATE_POSITION: {
				actions: ['updatePosition']
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
			START_COMBAT: {
				target: '#MINECRAFT_BOT.MAIN_ACTIVITY.COMBAT',
				actions: ['closeActiveWindowSession', 'setCombatTargetFromEvent']
			},
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
			],
			WINDOW_OPENED: {
				actions: ['recordExecutionSuccess', 'storeWindowSession']
			},
			WINDOW_CLOSE_FAILED: {
				actions: ['recordExecutionFailure', 'markWindowCloseFailed']
			}
		},
		states: {
			MAIN_ACTIVITY: {
				initial: 'IDLE',
				states: {
					IDLE: {
						on: {
							UPDATE_ENTITIES: [
								{
									guard: eventCanAutoEnterCombat,
									actions: ['closeActiveWindowSession', 'updateEntities'],
									target: '#MINECRAFT_BOT.MAIN_ACTIVITY.COMBAT',
								},
								{
									actions: ['updateEntities']
								}
							]
						}
					},
					URGENT_NEEDS: {
						on: {
							UPDATE_ENTITIES: [
								{
									guard: eventCanAutoEnterCombat,
									actions: ['closeActiveWindowSession', 'updateEntities'],
									target: '#MINECRAFT_BOT.MAIN_ACTIVITY.COMBAT',
								},
								{
									actions: ['updateEntities']
								}
							]
						},
						initial: 'EMERGENCY_EATING',
						states: {
							EMERGENCY_EATING: {
								on: {
									FOOD_RESTORED: [
										{
											guard: 'hasCurrentGoal',
											target: '#MINECRAFT_BOT.MAIN_ACTIVITY.TASKS.THINKING'
										},
										{
											target: '#MINECRAFT_BOT.MAIN_ACTIVITY.IDLE'
										}
									]
								},
								invoke: {
									src: 'emergencyEating',
									input: ({ context }: { context: MachineContext }) => ({
										bot: context.bot!,
										threshold: context.preferences.foodRestored
									}),
									onDone: [
										{
											guard: 'hasCurrentGoal',
											target: '#MINECRAFT_BOT.MAIN_ACTIVITY.TASKS.THINKING'
										},
										{
											target: '#MINECRAFT_BOT.MAIN_ACTIVITY.IDLE'
										}
									],
									onError: {
										target: '#MINECRAFT_BOT.MAIN_ACTIVITY.IDLE'
									}
								}
							},
							EMERGENCY_HEALING: {
								on: {
									HEALTH_RESTORED: [
										{
											guard: 'hasCurrentGoal',
											target: '#MINECRAFT_BOT.MAIN_ACTIVITY.TASKS.THINKING'
										},
										{
											target: '#MINECRAFT_BOT.MAIN_ACTIVITY.IDLE'
										}
									]
								},
								invoke: {
									src: 'emergencyHealing',
									input: ({ context }: { context: MachineContext }) => ({
										bot: context.bot!,
										threshold: context.preferences.healthFullyRestored
									}),
									onDone: [
										{
											guard: 'hasCurrentGoal',
											target: '#MINECRAFT_BOT.MAIN_ACTIVITY.TASKS.THINKING'
										},
										{
											target: '#MINECRAFT_BOT.MAIN_ACTIVITY.IDLE'
										}
									],
									onError: {
										target: '#MINECRAFT_BOT.MAIN_ACTIVITY.IDLE'
									}
								}
							}
						}
					},
					COMBAT: {
						entry: [
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
							UPDATE_ENTITIES: {
								actions: ['updateEntities']
							},
							WEAPON_BROKEN: {
								target: '.DECIDING'
							},
							ENEMY_BECAME_FAR: {
								target: '.DECIDING'
							},
							ENEMY_BECAME_CLOSE: {
								target: '.DECIDING'
							},
							NO_ENEMIES: [
								{
									guard: 'hasCurrentGoal',
									target: '#MINECRAFT_BOT.MAIN_ACTIVITY.TASKS.THINKING',
									actions: ['clearCombatTarget']
								},
								{
									target: '#MINECRAFT_BOT.MAIN_ACTIVITY.IDLE',
									actions: ['clearCombatTarget']
								}
							]
						},
						initial: 'DECIDING',
						states: {
							DECIDING: {
								always: [
									{
										target: 'FLEEING',
										guard: ({ context }) =>
											context.preferences.combatMode === 'retreat'
									},
									{
										target: 'MELEE_ATTACKING',
										guard: 'isEnemyInMeleeRange'
									},
									{
										target: 'RANGED_SKIRMISHING',
										guard: 'canSkirmishRanged'
									},
									{
										target: 'APPROACHING',
										guard: 'isEnemyNearby'
									}
								]
							},
							APPROACHING: {
								entry: [
									'ownMovementPathfinder',
									{
										type: 'logStateEntry',
										params: { state: 'MAIN_ACTIVITY.COMBAT.APPROACHING' }
									}
								],
								exit: [
									{
										type: 'logStateExit',
										params: { state: 'MAIN_ACTIVITY.COMBAT.APPROACHING' }
									}
								],
								on: {
									UPDATE_ENTITIES: [
										{
											guard: eventEnemyInMeleeRange,
											target: 'MELEE_ATTACKING',
											actions: ['updateEntities']
										},
										{
											guard: eventCanSkirmishRanged,
											target: 'RANGED_SKIRMISHING',
											actions: ['updateEntities']
										},
										{
											actions: ['updateEntities']
										}
									]
								},
								invoke: {
									src: 'serviceApproaching',
									input: ({ context }: { context: MachineContext }) => ({
										bot: context.bot
									})
								}
							},
							FLEEING: {
								entry: [
									'ownMovementPathfinder',
									{
										type: 'logStateEntry',
										params: { state: 'MAIN_ACTIVITY.COMBAT.FLEEING' }
									}
								],
								exit: [
									{
										type: 'logStateExit',
										params: { state: 'MAIN_ACTIVITY.COMBAT.FLEEING' }
									}
								],
								on: {
									UPDATE_ENTITIES: {
										actions: ['updateEntities']
									}
								},
								invoke: {
									src: 'serviceFleeing',
									input: ({ context }: { context: MachineContext }) => ({
										bot: context.bot
									})
								}
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
									UPDATE_ENTITIES: [
										{
											guard: eventCanSkirmishRanged,
											target: 'RANGED_SKIRMISHING',
											actions: ['updateEntities']
										},
										{
											guard: ({ event, context }) =>
												isEntityUpdateEvent(event) &&
												Boolean(event.nearestEnemy.entity) &&
												event.nearestEnemy.distance >
													context.preferences.enemyMeleeRange,
											target: 'APPROACHING',
											actions: ['updateEntities']
										},
										{
											actions: ['updateEntities']
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
									'ownMovementMicro',
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
									UPDATE_ENTITIES: [
										{
											guard: eventEnemyInMeleeRange,
											target: 'MELEE_ATTACKING',
											actions: ['updateEntities']
										},
										{
											guard: ({ event }) =>
												isEntityUpdateEvent(event) &&
												Boolean(event.nearestEnemy.entity),
											target: 'APPROACHING',
											actions: ['updateEntities']
										},
										{
											actions: ['updateEntities']
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
							UPDATE_ENTITIES: [
								{
									guard: eventCanAutoEnterCombat,
									actions: ['closeActiveWindowSession', 'updateEntities'],
									target: '#MINECRAFT_BOT.MAIN_ACTIVITY.COMBAT',
								},
								{
									actions: ['updateEntities']
								}
							]
						},
						initial: 'IDLE',
						states: {
							IDLE: {},
							THINKING: {
								entry: ['logThinkingStart'],
								invoke: {
									src: 'agentThinking',
									input: ({ context }: { context: MachineContext }) => ({
										bot: context.bot!,
										context
									}),
									onDone: [
										{
											guard: 'thinkingProducedExecution',
											target: 'EXECUTING',
											actions: ['logThinkingExecution', 'storeThinkingExecution']
										},
								{
									guard: 'thinkingProducedFinish',
									target: '#MINECRAFT_BOT.MAIN_ACTIVITY.IDLE',
									actions: [
										'closeActiveWindowSession',
										'logThinkingFinish',
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
											{ guard: 'isNavigateExecution', target: 'NAVIGATING' },
											{ guard: 'isBreakExecution', target: 'BREAKING' },
											{ guard: 'isOpenWindowExecution', target: 'OPEN_WINDOW' },
											{ guard: 'isTransferItemExecution', target: 'TRANSFER_ITEM' },
											{ guard: 'isCloseWindowExecution', target: 'CLOSE_WINDOW' },
											{ guard: 'isPlaceExecution', target: 'PLACING' },
											{ guard: 'isFollowExecution', target: 'FOLLOWING' },
											{
												target:
													'#MINECRAFT_BOT.MAIN_ACTIVITY.TASKS.DECIDE_NEXT',
												actions: ['recordExecutionFailure']
											}
										]
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
												actions: ['recordExecutionSuccess', 'storeWindowSession']
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
												actions: ['recordExecutionSuccess', 'clearWindowSession']
											},
											WINDOW_CLOSE_FAILED: {
												target:
													'#MINECRAFT_BOT.MAIN_ACTIVITY.TASKS.DECIDE_NEXT',
												actions: [
													'recordExecutionFailure',
													'markWindowCloseFailed'
												]
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
						on: {
							UPDATE_HEALTH: [
								{
									guard: ({ event, context }) =>
										event.type === 'UPDATE_HEALTH' &&
										event.health < context.preferences.healthEmergency,
									target:
										'#MINECRAFT_BOT.MAIN_ACTIVITY.URGENT_NEEDS.EMERGENCY_HEALING',
									actions: ['updateHealth']
								},
								{
									actions: ['updateHealth']
								}
							]
						}
					},
					HUNGER_MONITOR: {
						on: {
							UPDATE_FOOD: [
								{
									guard: ({ event, context }) =>
										event.type === 'UPDATE_FOOD' &&
										event.food < context.preferences.foodEmergency,
									target:
										'#MINECRAFT_BOT.MAIN_ACTIVITY.URGENT_NEEDS.EMERGENCY_EATING',
									actions: ['updateFood']
								},
								{
									actions: ['updateFood']
								}
							]
						}
					},
					ENTITIES_MONITOR: {
						on: {
							REMOVE_ENTITY: {
								actions: ['removeEntity']
							}
						},
						invoke: {
							src: 'serviceEntitiesTracking',
							input: ({ context }: { context: MachineContext }) => ({
								bot: context.bot
							})
						}
					}
				}
			}
		}
	})
}

export const machine = createBotMachine()
