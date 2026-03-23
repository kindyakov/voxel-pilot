import { type AgentTurnResult, runAgentTurn } from '@/ai/loop.js'
import type { PendingExecution } from '@/ai/tools.js'
import { Vec3 as Vec3Class } from 'vec3'
import { assign, fromPromise, setup } from 'xstate'

import type { Bot, Entity } from '@types'

import combatActors from '@hsm/actors/combat.actors'
import monitoringActors from '@hsm/actors/monitoring.actors'
import { primitiveBreaking } from '@hsm/actors/primitives/primitiveBreaking.primitive'
import { primitiveCraft } from '@hsm/actors/primitives/primitiveCraft.primitive'
import { primitiveCraftInWorkbench } from '@hsm/actors/primitives/primitiveCraftInWorkbench.primitive'
import { primitiveFollowing } from '@hsm/actors/primitives/primitiveFollowing.primitive'
import { primitiveNavigating } from '@hsm/actors/primitives/primitiveNavigating.primitive'
import { primitivePlacing } from '@hsm/actors/primitives/primitivePlacing.primitive'
import { primitiveSmelt } from '@hsm/actors/primitives/primitiveSmelt.primitive'
import { type MachineContext, context } from '@hsm/context'
import combatGuards from '@hsm/guards/combat.guards'
import type { MachineEvent } from '@hsm/types'

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
		signal
	})
})

const fallbackExecutionActor = fromPromise(async () => {
	throw new Error('Unsupported execution tool')
})

const isRecord = (value: unknown): value is Record<string, unknown> =>
	Boolean(value) && typeof value === 'object' && !Array.isArray(value)

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

const resolveExecutionActor = (context: MachineContext) => {
	switch (context.pendingExecution?.toolName) {
		case 'call_navigate':
			return primitiveNavigating
		case 'call_break_block':
			return primitiveBreaking
		case 'call_craft':
			return primitiveCraft
		case 'call_craft_workbench':
			return primitiveCraftInWorkbench
		case 'call_smelt':
			return primitiveSmelt
		case 'call_place_block':
			return primitivePlacing
		case 'call_follow_entity':
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
		case 'call_navigate':
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
		case 'call_break_block': {
			const targetPosition = tryGetPositionArg(execution, 'position')
			const block = targetPosition ? bot.blockAt(targetPosition) : null
			return {
				bot,
				options: {
					block: block as any
				}
			}
		}
		case 'call_craft':
			return {
				bot,
				options: {
					itemName: String(execution.args.item_name ?? ''),
					count:
						typeof execution.args.count === 'number'
							? execution.args.count
							: undefined
				}
			}
		case 'call_craft_workbench': {
			const workbenchPosition = tryGetPositionArg(
				execution,
				'workbench_position'
			)
			const craftingTable = workbenchPosition
				? bot.blockAt(workbenchPosition)
				: null
			return {
				bot,
				options: {
					itemName: String(execution.args.item_name ?? ''),
					count:
						typeof execution.args.count === 'number'
							? execution.args.count
							: undefined,
					craftingTable: craftingTable as any
				}
			}
		}
		case 'call_smelt': {
			const furnacePosition = tryGetPositionArg(execution, 'furnace_position')
			const furnace = furnacePosition ? bot.blockAt(furnacePosition) : null
			return {
				bot,
				options: {
					inputItemName: String(execution.args.input_item_name ?? ''),
					fuelItemName:
						typeof execution.args.fuel_item_name === 'string'
							? execution.args.fuel_item_name
							: undefined,
					count:
						typeof execution.args.count === 'number'
							? execution.args.count
							: undefined,
					furnace: furnace as any
				}
			}
		}
		case 'call_place_block':
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
		case 'call_follow_entity': {
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

				if (typeof execution.args.entity_name === 'string') {
					return (
						entity.username === execution.args.entity_name ||
						entity.name === execution.args.entity_name
					)
				}

				if (typeof execution.args.entity_type === 'string') {
					return (
						entity.type === execution.args.entity_type ||
						entity.name === execution.args.entity_type
					)
				}

				return false
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
	}
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
			serviceFleeing:
				actorOverrides.serviceFleeing ?? combatActors.serviceFleeing,
			serviceMeleeAttack:
				actorOverrides.serviceMeleeAttack ?? combatActors.serviceMeleeAttack,
			serviceRangedAttack:
				actorOverrides.serviceRangedAttack ?? combatActors.serviceRangedAttack
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
				context.pendingExecution?.toolName === 'call_navigate',
			isBreakExecution: ({ context }) =>
				context.pendingExecution?.toolName === 'call_break_block',
			isCraftExecution: ({ context }) =>
				context.pendingExecution?.toolName === 'call_craft',
			isCraftWorkbenchExecution: ({ context }) =>
				context.pendingExecution?.toolName === 'call_craft_workbench',
			isSmeltExecution: ({ context }) =>
				context.pendingExecution?.toolName === 'call_smelt',
			isPlaceExecution: ({ context }) =>
				context.pendingExecution?.toolName === 'call_place_block',
			isFollowExecution: ({ context }) =>
				context.pendingExecution?.toolName === 'call_follow_entity'
		},
		actions: {
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
				health: ({ event }) =>
					event.type === 'UPDATE_HEALTH' ? event.health : 20
			}),
			updateFood: assign({
				food: ({ event }) => (event.type === 'UPDATE_FOOD' ? event.food : 20)
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
				nearestEnemy: ({ event }) =>
					event.type === 'UPDATE_ENTITIES'
						? event.nearestEnemy
						: { entity: null, distance: Infinity }
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
							: context.nearestEnemy
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
				currentGoal: null,
				subGoal: null,
				pendingExecution: null,
				lastToolTranscript: []
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
					pendingExecution: null,
					lastToolTranscript: [],
					failureSignature: null,
					failureRepeats: 0,
					errorHistory: []
				}
			}),
			clearGoal: assign({
				currentGoal: null,
				subGoal: null,
				pendingExecution: null,
				lastToolTranscript: [],
				failureSignature: null,
				failureRepeats: 0
			}),
			storeThinkingExecution: assign(({ event }) => {
				const output = (event as any).output as AgentTurnResult
				if (output.kind !== 'execute') {
					return {}
				}

				return {
					pendingExecution: output.execution,
					subGoal: output.subGoal,
					lastToolTranscript: output.transcript
				}
			}),
			storeThinkingFailure: assign(({ event }) => {
				const output = (event as any).output as AgentTurnResult
				if (output.kind !== 'failed') {
					return {}
				}

				return {
					lastResult: 'FAILED' as const,
					lastReason: output.reason,
					lastToolTranscript: output.transcript,
					pendingExecution: null
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
				lastToolTranscript: [event.type]
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
					lastToolTranscript: [event.type]
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
				actions: ['updateAfterDeath']
			},
			USER_COMMAND: {
				target: '#MINECRAFT_BOT.MAIN_ACTIVITY.TASKS.THINKING',
				actions: ['setGoalFromUserCommand']
			},
			STOP_CURRENT_GOAL: {
				target: '#MINECRAFT_BOT.MAIN_ACTIVITY.IDLE',
				actions: ['clearGoal']
			},
			START_COMBAT: {
				target: '#MINECRAFT_BOT.MAIN_ACTIVITY.COMBAT'
			},
			START_URGENT_NEEDS: [
				{
					guard: ({ event }) =>
						event.type === 'START_URGENT_NEEDS' && event.need === 'food',
					target: '#MINECRAFT_BOT.MAIN_ACTIVITY.URGENT_NEEDS.EMERGENCY_EATING'
				},
				{
					guard: ({ event }) =>
						event.type === 'START_URGENT_NEEDS' && event.need === 'health',
					target: '#MINECRAFT_BOT.MAIN_ACTIVITY.URGENT_NEEDS.EMERGENCY_HEALING'
				}
			]
		},
		states: {
			MAIN_ACTIVITY: {
				initial: 'IDLE',
				states: {
					IDLE: {},
					URGENT_NEEDS: {
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
						initial: 'DECIDING',
						on: {
							NO_ENEMIES: [
								{
									guard: 'hasCurrentGoal',
									target: '#MINECRAFT_BOT.MAIN_ACTIVITY.TASKS.THINKING'
								},
								{
									target: '#MINECRAFT_BOT.MAIN_ACTIVITY.IDLE'
								}
							]
						},
						states: {
							DECIDING: {
								always: [
									{ target: 'DEFENDING', guard: 'isSurrounded' },
									{
										target: 'RANGED_ATTACKING',
										guard: 'canUseRangedAndEnemyFar'
									},
									{ target: 'MELEE_ATTACKING' }
								]
							},
							FLEEING: {
								invoke: {
									src: 'serviceFleeing',
									input: ({ context }: { context: MachineContext }) => ({
										bot: context.bot
									})
								}
							},
							MELEE_ATTACKING: {
								on: {
									ENEMY_BECAME_FAR: {
										target: 'RANGED_ATTACKING',
										guard: 'canUseRangedAndEnemyFar'
									}
								},
								invoke: {
									src: 'serviceMeleeAttack',
									input: ({ context }: { context: MachineContext }) => ({
										bot: context.bot
									})
								}
							},
							RANGED_ATTACKING: {
								on: {
									ENEMY_BECAME_CLOSE: {
										target: 'MELEE_ATTACKING'
									}
								},
								invoke: {
									src: 'serviceRangedAttack',
									input: ({ context }: { context: MachineContext }) => ({
										bot: context.bot
									})
								}
							},
							DEFENDING: {
								on: {
									NOT_SURROUNDED: {
										target: 'DECIDING'
									}
								}
							}
						}
					},
					TASKS: {
						entry: ['markTaskActive'],
						exit: ['markTaskInactive'],
						initial: 'IDLE',
						states: {
							IDLE: {},
							THINKING: {
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
											actions: ['storeThinkingExecution']
										},
										{
											guard: 'thinkingProducedFinish',
											target: '#MINECRAFT_BOT.MAIN_ACTIVITY.IDLE',
											actions: ['notifyGoalFinished', 'clearGoal']
										},
										{
											target: '#MINECRAFT_BOT.MAIN_ACTIVITY.IDLE',
											actions: [
												'storeThinkingFailure',
												'notifyThinkingFailure',
												'clearGoal'
											]
										}
									],
									onError: {
										target: '#MINECRAFT_BOT.MAIN_ACTIVITY.IDLE',
										actions: ['clearGoal']
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
											{ guard: 'isCraftExecution', target: 'CRAFTING' },
											{
												guard: 'isCraftWorkbenchExecution',
												target: 'CRAFTING_WORKBENCH'
											},
											{ guard: 'isSmeltExecution', target: 'SMELTING' },
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
									CRAFTING: {
										invoke: {
											src: primitiveCraft,
											input: ({ context }: { context: MachineContext }) =>
												resolveExecutionInput(context)
										},
										on: {
											CRAFTED: {
												target:
													'#MINECRAFT_BOT.MAIN_ACTIVITY.TASKS.DECIDE_NEXT',
												actions: ['recordExecutionSuccess']
											},
											CRAFT_FAILED: {
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
									CRAFTING_WORKBENCH: {
										invoke: {
											src: primitiveCraftInWorkbench,
											input: ({ context }: { context: MachineContext }) =>
												resolveExecutionInput(context)
										},
										on: {
											CRAFTED: {
												target:
													'#MINECRAFT_BOT.MAIN_ACTIVITY.TASKS.DECIDE_NEXT',
												actions: ['recordExecutionSuccess']
											},
											CRAFT_FAILED: {
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
									SMELTING: {
										invoke: {
											src: primitiveSmelt,
											input: ({ context }: { context: MachineContext }) =>
												resolveExecutionInput(context)
										},
										on: {
											SMELTED: {
												target:
													'#MINECRAFT_BOT.MAIN_ACTIVITY.TASKS.DECIDE_NEXT',
												actions: ['recordExecutionSuccess']
											},
											SMELT_FAILED: {
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
										actions: ['notifyLoopAbort', 'clearGoal']
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
							UPDATE_ENTITIES: [
								{
									guard: ({ event }) =>
										event.type === 'UPDATE_ENTITIES' &&
										Boolean(event.nearestEnemy.entity),
									target: '#MINECRAFT_BOT.MAIN_ACTIVITY.COMBAT',
									actions: ['updateEntities']
								},
								{
									actions: ['updateEntities']
								}
							],
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
