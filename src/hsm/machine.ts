import { createMachine, assign } from 'xstate'
import type { Bot } from '@types'
import type { MachineActionParams, MachineEvent } from '@hsm/types'
import { context, type MachineContext } from '@hsm/context'
import type {
	AnyTaskData,
	MiningTaskData,
	FollowingTaskData,
	SmeltingTaskData,
	CraftingTaskData,
	SleepingTaskData,
	FarmingTaskData
} from '@hsm/tasks/index'
import { actions } from '@hsm/actions/index.actions'
import { guards } from '@hsm/guards/index.guards'
import { actors } from '@hsm/actors/index.actors'

export const machine = createMachine(
	{
		types: {} as {
			context: MachineContext
			events: MachineEvent
			input: { bot: Bot }
		},
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
			DEATH: {
				target: '#MINECRAFT_BOT.MAIN_ACTIVITY.IDLE',
				actions: ['updateAfterDeath']
			}
		},
		states: {
			MAIN_ACTIVITY: {
				initial: 'IDLE',

				states: {
					IDLE: {
						description: 'Ожидание (приоритет 1)',
						entry: { type: 'entryIdle' },
						exit: { type: 'exitIdle' },
						on: {
							START_MINING: {
								target: '#MINECRAFT_BOT.MAIN_ACTIVITY.TASKS.MINING',
								actions: assign({
									taskData: ({
										event
									}: {
										event: MachineEvent & { type: 'START_MINING' }
									}) => event.taskData
								})
							},
							START_FOLLOWING: {
								target: '#MINECRAFT_BOT.MAIN_ACTIVITY.TASKS.FOLLOWING',
								actions: assign({
									taskData: ({
										event
									}: {
										event: MachineEvent & { type: 'START_FOLLOWING' }
									}) => event.taskData
								})
							},
							START_SMELTING: {
								target: '#MINECRAFT_BOT.MAIN_ACTIVITY.TASKS.SMELTING',
								actions: assign({
									taskData: ({
										event
									}: {
										event: MachineEvent & { type: 'START_SMELTING' }
									}) => event.taskData
								})
							},
							START_CRAFTING: {
								target: '#MINECRAFT_BOT.MAIN_ACTIVITY.TASKS.CRAFTING',
								actions: assign({
									taskData: ({
										event
									}: {
										event: MachineEvent & { type: 'START_CRAFTING' }
									}) => event.taskData
								})
							},
							START_SLEEPING: {
								target: '#MINECRAFT_BOT.MAIN_ACTIVITY.TASKS.SLEEPING',
								actions: assign({
									taskData: ({
										event
									}: {
										event: MachineEvent & { type: 'START_SLEEPING' }
									}) => event.taskData
								})
							},
							START_FARMING: {
								target: '#MINECRAFT_BOT.MAIN_ACTIVITY.TASKS.FARMING',
								actions: assign({
									taskData: ({
										event
									}: {
										event: MachineEvent & { type: 'START_FARMING' }
									}) => event.taskData
								})
							}
						}
					},
					URGENT_NEEDS: {
						description: 'Срочные потребности (приоритет 8)',
						initial: 'EMERGENCY_EATING',
						states: {
							EMERGENCY_EATING: {
								entry: {
									type: 'entryEmergencyEating'
								},
								exit: {
									type: 'exitEmergencyEating'
								},
								invoke: {
									id: 'emergencyEating',
									src: 'serviceEmergencyEating',
									input: ({ context }: { context: MachineContext }) => ({
										bot: context.bot
									})
								},
								on: {
									FOOD_RESTORED: {
										target: '#MINECRAFT_BOT.MAIN_ACTIVITY.hist'
									}
								}
							},
							EMERGENCY_HEALING: {
								entry: {
									type: 'entryEmergencyHealing'
								},
								exit: {
									type: 'exitEmergencyHealing'
								},
								invoke: {
									id: 'emergencyHealing',
									src: 'serviceEmergencyHealing',
									input: ({ context }: { context: MachineContext }) => ({
										bot: context.bot
									})
								},
								on: {
									HEALTH_RESTORED: {
										target: '#MINECRAFT_BOT.MAIN_ACTIVITY.hist'
									}
								}
							}
						}
					},
					COMBAT: {
						initial: 'DECIDING',
						description: 'Состояние сражения (приоритет 7.5)',
						entry: { type: 'entryCombat' },
						exit: { type: 'exitCombat' },
						on: {
							NO_ENEMIES: {
								target: '#MINECRAFT_BOT.MAIN_ACTIVITY.hist'
							}
						},
						states: {
							DECIDING: {
								entry: { type: 'entryDeciding' },
								exit: { type: 'exitDeciding' },
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
								entry: { type: 'entryFleeing' },
								exit: { type: 'exitFleeing' },
								invoke: {
									id: 'fleeing',
									src: 'serviceFleeing',
									input: ({ context }: { context: MachineContext }) => ({
										bot: context.bot
									})
								}
							},
							MELEE_ATTACKING: {
								description: 'Ближний бой',
								entry: { type: 'entryMeleeAttacking' },
								exit: { type: 'exitMeleeAttack' },
								on: {
									ENEMY_BECAME_FAR: {
										target: 'RANGED_ATTACKING',
										guard: 'canUseRangedAndEnemyFar'
									}
								},
								invoke: {
									id: 'meleeAttack',
									src: 'serviceMeleeAttack',
									input: ({ context }: { context: MachineContext }) => ({
										bot: context.bot
									})
								}
							},
							RANGED_ATTACKING: {
								entry: 'entryRangedAttacking',
								exit: 'exitRangedAttacking',
								on: {
									ENEMY_BECAME_CLOSE: {
										target: 'MELEE_ATTACKING'
									}
								},
								invoke: {
									id: 'rangedAttack',
									src: 'serviceRangedAttack',
									input: ({ context }: { context: MachineContext }) => ({
										bot: context.bot
									})
								}
							},
							DEFENDING: {
								entry: 'entryDefending',
								exit: 'exitDefending',
								on: {
									NOT_SURROUNDED: {
										target: 'DECIDING'
									}
								}
							}
						}
					},
					hist: {
						history: 'shallow',
						type: 'history'
					},
					TASKS: {
						initial: 'PLAN_EXECUTOR',
						entry: ['entryTasks'],
						exit: ['exitTasks'],
						states: {
							PLAN_EXECUTOR: {
								initial: 'IDLE',
								states: {
									IDLE: {
										on: {
											START_PLAN: {
												target: 'VALIDATING',
												actions: ['startPlan']
											}
										}
									},
									VALIDATING: {},
									EXECUTING_TASK: {}
								}
							},

							MINING: {
								initial: 'CHECKING_PRECONDITIONS',
								entry: [
									'entryMining'
									// assign({
									// 	taskData: actions.restoreMiningProgress
									// })
								],
								exit: { type: 'exitMining' },
								onDone: {
									target: '#MINECRAFT_BOT.MAIN_ACTIVITY.IDLE',
									actions: assign({
										taskData: () => null
									})
								},
								states: {
									CHECKING_PRECONDITIONS: {
										entry: {
											type: 'entryCheckingPreconditions'
										},
										exit: {
											type: 'exitCheckingPreconditions'
										},
										always: [
											// {
											// 	guard: 'hasInventorySpace',
											// 	target: ''
											// },
											{
												guard: 'hasRequiredTool',
												target: 'SEARCHING'
											},
											{
												target: 'REQUESTING_TOOL'
											}
										]
									},
									REQUESTING_TOOL: {
										// Новое состояние - пока заглушка
										entry: ({ context }: MachineActionParams) => {
											const taskData = context.taskData as MiningTaskData
											console.log(
												`❌ [REQUESTING_TOOL] Нужен инструмент для "${taskData?.blockName}"`
											)
											console.log(
												'   Задание будет завершено через 3 секунды...'
											)
											context.bot?.chat(
												`Нужен инструмент для "${taskData?.blockName}"`
											)
										},
										after: {
											3000: 'TASK_FAILED'
										}
									},
									SEARCHING: {
										invoke: {
											id: 'miningSearching',
											src: 'primitiveSearchBlock',
											input: ({ context }: { context: MachineContext }) => ({
												bot: context.bot,
												options: {
													blockName: (context.taskData as MiningTaskData)
														.blockName,
													count: (context.taskData as MiningTaskData).count
												}
											})
										},
										on: {
											FOUND: {
												target: 'CHECKING_DISTANCE',
												actions: assign({
													taskData: ({
														context,
														event
													}: {
														context: MachineContext
														event: Extract<MachineEvent, { type: 'FOUND' }>
													}) => ({
														...(context.taskData as MiningTaskData),
														targetBlock: event.block
													})
												})
											},
											NOT_FOUND: 'TASK_FAILED'
										}
									},
									CHECKING_DISTANCE: {
										always: [
											{
												target: 'BREAKING',
												guard: 'isBlockNearby'
											},
											{
												target: 'NAVIGATING'
											}
										]
									},
									NAVIGATING: {
										invoke: {
											id: 'miningNavigating',
											src: 'primitiveNavigating',
											input: ({ context }: { context: MachineContext }) => ({
												bot: context.bot,
												options: {
													target: (context.taskData as MiningTaskData)
														.targetBlock
												}
											})
										},
										on: {
											ARRIVED: {
												target: 'BREAKING'
											},
											NAVIGATION_FAILED: [
												{
													guard: ({ context }) => {
														const data = context.taskData as MiningTaskData
														return data.navigationAttempts >= 3
													},
													target: 'TASK_FAILED'
												},
												{
													target: 'SEARCHING',
													actions: assign({
														taskData: ({ context }) => ({
															...(context.taskData as MiningTaskData),
															navigationAttempts:
																(context.taskData as MiningTaskData)
																	.navigationAttempts + 1
														})
													})
												}
											]
										}
									},
									BREAKING: {
										invoke: {
											id: 'miningBreaking',
											src: 'primitiveBreaking',
											input: ({ context }: { context: MachineContext }) => ({
												bot: context.bot,
												options: {
													block: (context.taskData as MiningTaskData)
														.targetBlock
												}
											})
										},
										on: {
											BROKEN: {
												target: 'CHECKING_GOAL',
												actions: assign({
													taskData: ({ context }) => ({
														...(context.taskData as MiningTaskData),
														collected:
															((context.taskData as MiningTaskData).collected ||
																0) + 1
													})
												})
											},
											BREAKING_FAILED: 'SEARCHING'
										}
									},
									CHECKING_GOAL: {
										entry: ({ context }) => {
											const data = context.taskData as MiningTaskData
											console.log(
												`📊 CHECKING_GOAL: collected=${data.collected}, count=${data.count}`
											)
										},
										always: [
											{
												guard: ({ context }: { context: MachineContext }) => {
													const taskData =
														context.taskData as MiningTaskData | null
													return taskData
														? (taskData.collected || 0) >= (taskData.count || 1)
														: false
												},
												target: 'TASK_COMPLETED'
											},
											{
												target: 'SEARCHING' // ← Цикл: ищем следующий блок
											}
										]
									},
									TASK_COMPLETED: {
										type: 'final',
										entry: 'taskMiningCompleted'
									},
									TASK_FAILED: {
										type: 'final',
										entry: 'taskMiningFailed'
									}
								}
							},

							FOLLOWING: {
								initial: 'SEARCHING_TARGET',
								entry: 'entryFollowing',
								exit: 'exitFollowing',
								onDone: {
									target: '#MINECRAFT_BOT.MAIN_ACTIVITY.IDLE',
									actions: assign({
										taskData: () => null
									})
								},
								states: {
									SEARCHING_TARGET: {
										entry: 'entrySearchingTarget',
										invoke: {
											id: 'followingSearching',
											src: 'primitiveSearchEntity',
											input: ({ context }: { context: MachineContext }) => {
												const { entityName, entityType, maxDistance } =
													context.taskData as FollowingTaskData

												return {
													bot: context.bot,
													options: {
														entityName,
														entityType,
														maxDistance
													}
												}
											}
										},
										on: {
											FOUND: {
												target: 'FOLLOWING_TARGET',
												actions: assign({
													taskData: ({
														context,
														event
													}: {
														context: MachineContext
														event: Extract<MachineEvent, { type: 'FOUND' }>
													}) => ({
														...(context.taskData as FollowingTaskData),
														targetEntity: event.entity
													})
												})
											},
											NOT_FOUND: {
												target: 'TASK_FAILED'
											}
										}
									},
									FOLLOWING_TARGET: {
										entry: 'entryFollowingTarget',
										exit: 'exitFollowingTarget',
										invoke: {
											id: 'followingTarget',
											src: 'primitiveFollowing',
											input: ({ context }: { context: MachineContext }) => {
												const taskData = context.taskData as FollowingTaskData
												return {
													bot: context.bot,
													options: {
														target: taskData.targetEntity,
														distance: taskData.distance || 3
													}
												}
											}
										},
										on: {
											FOLLOWING_STOPPED: {
												target: 'TASK_COMPLETED'
											},
											FOLLOWING_FAILED: 'TASK_FAILED'
										}
									},
									TASK_COMPLETED: {
										type: 'final',
										entry: 'taskFollowingCompleted'
									},
									TASK_FAILED: {
										type: 'final',
										entry: 'taskFollowingFailed'
									}
								}
							},

							SMELTING: {
								initial: 'CHECKING_PRECONDITIONS',
								entry: 'entrySmelting',
								exit: 'exitSmelting',
								onDone: {
									target: '#MINECRAFT_BOT.MAIN_ACTIVITY.IDLE',
									actions: assign({
										taskData: () => null
									})
								},
								states: {
									CHECKING_PRECONDITIONS: {
										entry: 'entryCheckingSmeltingPreconditions',
										always: [
											{
												guard: ({ context }: { context: MachineContext }) => {
													const taskData = context.taskData as SmeltingTaskData
													const bot = context.bot
													if (!bot || !taskData) return false

													// Проверяем наличие входного материала и топлива в инвентаре
													const inputItem =
														bot.registry.itemsByName[taskData.inputItem]
													const fuelItem =
														bot.registry.itemsByName[taskData.fuel]

													if (!inputItem || !fuelItem) return false

													const inputCount = bot.utils.countItemInInventory(
														inputItem.id
													)
													const fuelCount = bot.utils.countItemInInventory(
														fuelItem.id
													)

													return (
														inputCount >= taskData.count - taskData.smelted &&
														fuelCount >= 1
													)
												},
												target: 'SEARCHING_FURNACE'
											},
											{
												target: 'TASK_FAILED'
											}
										]
									},
									SEARCHING_FURNACE: {
										entry: 'entrySearchingFurnace',
										invoke: {
											id: 'smeltingSearchingFurnace',
											src: 'primitiveSearchBlock',
											input: ({ context }: { context: MachineContext }) => ({
												bot: context.bot,
												options: {
													blockName: 'furnace',
													maxDistance: 32
												}
											})
										},
										on: {
											FOUND: {
												target: 'CHECKING_DISTANCE',
												actions: assign({
													taskData: ({
														context,
														event
													}: {
														context: MachineContext
														event: Extract<MachineEvent, { type: 'FOUND' }>
													}) => ({
														...(context.taskData as SmeltingTaskData),
														furnace: event.block
													})
												})
											},
											NOT_FOUND: 'TASK_FAILED'
										}
									},
									CHECKING_DISTANCE: {
										always: [
											{
												target: 'SMELTING_ITEMS',
												guard: ({ context }: { context: MachineContext }) => {
													const taskData =
														context.taskData as SmeltingTaskData & {
															furnace?: any
														}
													const bot = context.bot
													if (!bot || !taskData.furnace) return false

													const distance = bot.entity.position.distanceTo(
														taskData.furnace.position
													)
													return distance <= 4
												}
											},
											{
												target: 'NAVIGATING'
											}
										]
									},
									NAVIGATING: {
										entry: 'entrySmeltingNavigating',
										invoke: {
											id: 'smeltingNavigating',
											src: 'primitiveNavigating',
											input: ({ context }: { context: MachineContext }) => {
												const taskData =
													context.taskData as SmeltingTaskData & {
														furnace?: any
													}
												return {
													bot: context.bot,
													options: {
														target: taskData.furnace
													}
												}
											}
										},
										on: {
											ARRIVED: {
												target: 'SMELTING_ITEMS'
											},
											NAVIGATION_FAILED: 'TASK_FAILED'
										}
									},
									SMELTING_ITEMS: {
										invoke: {
											id: 'smeltingItems',
											src: 'primitiveSmelt',
											input: ({ context }: { context: MachineContext }) => {
												const taskData =
													context.taskData as SmeltingTaskData & {
														furnace?: any
													}
												const remainingCount = taskData.count - taskData.smelted
												return {
													bot: context.bot,
													options: {
														inputItemName: taskData.inputItem,
														fuelItemName: taskData.fuel,
														furnace: taskData.furnace,
														count: remainingCount > 0 ? remainingCount : 1
													}
												}
											}
										},
										on: {
											SMELTED: {
												target: 'CHECKING_GOAL',
												actions: assign({
													taskData: ({ context, event }) => {
														const currentData =
															context.taskData as SmeltingTaskData
														const smeltedEvent = event as Extract<
															MachineEvent,
															{ type: 'SMELTED' }
														>
														return {
															...currentData,
															smelted: currentData.smelted + smeltedEvent.count
														}
													}
												})
											},
											SMELT_FAILED: 'TASK_FAILED'
										}
									},
									CHECKING_GOAL: {
										always: [
											{
												guard: ({ context }: { context: MachineContext }) => {
													const taskData = context.taskData as SmeltingTaskData
													return taskData.smelted >= taskData.count
												},
												target: 'TASK_COMPLETED'
											},
											{
												target: 'SEARCHING_FURNACE'
											}
										]
									},
									TASK_COMPLETED: {
										type: 'final',
										entry: 'taskSmeltingCompleted'
									},
									TASK_FAILED: {
										type: 'final',
										entry: 'taskSmeltingFailed'
									}
								}
							},
							CRAFTING: {
								initial: 'CHECKING_RECIPE',
								entry: 'entryCrafting',
								exit: 'exitCrafting',
								onDone: {
									target: '#MINECRAFT_BOT.MAIN_ACTIVITY.IDLE',
									actions: assign({
										taskData: () => null
									})
								},
								states: {
									CHECKING_RECIPE: {
										entry: 'entryCheckingRecipe',
										always: [
											{
												guard: ({ context }: { context: MachineContext }) => {
													const taskData = context.taskData as CraftingTaskData
													const bot = context.bot
													if (!bot || !taskData) return false

													// Проверяем существование рецепта
													const recipe = bot.registry.recipesFor(
														bot.registry.itemsByName[taskData.recipe]?.id,
														null,
														1,
														null
													)

													return recipe && recipe.length > 0
												},
												target: 'CRAFTING_ITEMS'
											},
											{
												target: 'TASK_FAILED'
											}
										]
									},
									CRAFTING_ITEMS: {
										invoke: {
											id: 'craftingItems',
											src: 'primitiveCraft',
											input: ({ context }: { context: MachineContext }) => {
												const taskData = context.taskData as CraftingTaskData
												const remainingCount = taskData.count - taskData.crafted
												return {
													bot: context.bot,
													options: {
														recipe: taskData.recipe,
														count: remainingCount > 0 ? remainingCount : 1
													}
												}
											}
										},
										on: {
											CRAFTED: {
												target: 'CHECKING_GOAL',
												actions: assign({
													taskData: ({ context, event }) => {
														const currentData =
															context.taskData as CraftingTaskData
														const craftedEvent = event as Extract<
															MachineEvent,
															{ type: 'CRAFTED' }
														>
														return {
															...currentData,
															crafted: currentData.crafted + craftedEvent.count
														}
													}
												})
											},
											CRAFT_FAILED: 'TASK_FAILED'
										}
									},
									CHECKING_GOAL: {
										always: [
											{
												guard: ({ context }: { context: MachineContext }) => {
													const taskData = context.taskData as CraftingTaskData
													return taskData.crafted >= taskData.count
												},
												target: 'TASK_COMPLETED'
											},
											{
												target: 'CRAFTING_ITEMS'
											}
										]
									},
									TASK_COMPLETED: {
										type: 'final',
										entry: 'taskCraftingCompleted'
									},
									TASK_FAILED: {
										type: 'final',
										entry: 'taskCraftingFailed'
									}
								}
							},
							BUILDING: {},
							SLEEPING: {
								initial: 'SEARCHING_BED',
								entry: 'entrySleeping',
								exit: 'exitSleeping',
								onDone: {
									target: '#MINECRAFT_BOT.MAIN_ACTIVITY.IDLE',
									actions: assign({
										taskData: () => null
									})
								},
								states: {
									SEARCHING_BED: {
										entry: 'entrySearchingBed',
										invoke: {
											id: 'sleepingSearchingBed',
											src: 'primitiveSearchBlock',
											input: ({ context }: { context: MachineContext }) => ({
												bot: context.bot,
												options: {
													blockName: 'bed',
													maxDistance: 32
												}
											})
										},
										on: {
											FOUND: {
												target: 'CHECKING_DISTANCE',
												actions: assign({
													taskData: ({
														context,
														event
													}: {
														context: MachineContext
														event: Extract<MachineEvent, { type: 'FOUND' }>
													}) => ({
														...(context.taskData as SleepingTaskData),
														targetBed: event.block
													})
												})
											},
											NOT_FOUND: 'TASK_FAILED'
										}
									},
									CHECKING_DISTANCE: {
										always: [
											{
												target: 'SLEEPING_IN_BED',
												guard: ({ context }: { context: MachineContext }) => {
													const taskData =
														context.taskData as SleepingTaskData & {
															targetBed?: any
														}
													const bot = context.bot
													if (!bot || !taskData.targetBed) return false

													const distance = bot.entity.position.distanceTo(
														taskData.targetBed.position
													)
													return distance <= 4
												}
											},
											{
												target: 'NAVIGATING'
											}
										]
									},
									NAVIGATING: {
										invoke: {
											id: 'sleepingNavigating',
											src: 'primitiveNavigating',
											input: ({ context }: { context: MachineContext }) => {
												const taskData =
													context.taskData as SleepingTaskData & {
														targetBed?: any
													}
												return {
													bot: context.bot,
													options: {
														target: taskData.targetBed
													}
												}
											}
										},
										on: {
											ARRIVED: {
												target: 'SLEEPING_IN_BED'
											},
											NAVIGATION_FAILED: 'TASK_FAILED'
										}
									},
									SLEEPING_IN_BED: {
										entry: async ({ context }: MachineActionParams) => {
											const bot = context.bot
											if (!bot) return

											const taskData = context.taskData as SleepingTaskData & {
												targetBed?: any
											}
											if (!taskData.targetBed) return

											try {
												console.log(
													`🛏️ [SLEEPING] Сон в кровати на ${taskData.targetBed.position}`
												)
												await bot.sleep(taskData.targetBed)
												console.log('✅ [SLEEPING] Проснулся!')
											} catch (error) {
												console.error('❌ [SLEEPING] Ошибка сна:', error)
											}
										},
										after: {
											1000: 'TASK_COMPLETED'
										}
									},
									TASK_COMPLETED: {
										type: 'final',
										entry: 'taskSleepingCompleted'
									},
									TASK_FAILED: {
										type: 'final',
										entry: 'taskSleepingFailed'
									}
								}
							},
							FARMING: {
								initial: 'SEARCHING_CROP',
								entry: 'entryFarming',
								exit: 'exitFarming',
								onDone: {
									target: '#MINECRAFT_BOT.MAIN_ACTIVITY.IDLE',
									actions: assign({
										taskData: () => null
									})
								},
								states: {
									SEARCHING_CROP: {
										entry: 'entrySearchingCrop',
										invoke: {
											id: 'farmingSearchingCrop',
											src: 'primitiveSearchBlock',
											input: ({ context }: { context: MachineContext }) => {
												const taskData = context.taskData as FarmingTaskData
												// Ищем полностью выросшие культуры (возраст 7)
												const cropNameWithAge = `${taskData.cropName}_7`
												return {
													bot: context.bot,
													options: {
														blockName: cropNameWithAge,
														maxDistance: taskData.maxDistance || 32
													}
												}
											}
										},
										on: {
											FOUND: {
												target: 'CHECKING_DISTANCE',
												actions: assign({
													taskData: ({
														context,
														event
													}: {
														context: MachineContext
														event: Extract<MachineEvent, { type: 'FOUND' }>
													}) => ({
														...(context.taskData as FarmingTaskData),
														targetCrop: event.block
													})
												})
											},
											NOT_FOUND: 'TASK_FAILED'
										}
									},
									CHECKING_DISTANCE: {
										always: [
											{
												target: 'HARVESTING',
												guard: ({ context }: { context: MachineContext }) => {
													const taskData =
														context.taskData as FarmingTaskData & {
															targetCrop?: any
														}
													const bot = context.bot
													if (!bot || !taskData.targetCrop) return false

													const distance = bot.entity.position.distanceTo(
														taskData.targetCrop.position
													)
													return distance <= 4
												}
											},
											{
												target: 'NAVIGATING'
											}
										]
									},
									NAVIGATING: {
										invoke: {
											id: 'farmingNavigating',
											src: 'primitiveNavigating',
											input: ({ context }: { context: MachineContext }) => {
												const taskData = context.taskData as FarmingTaskData & {
													targetCrop?: any
												}
												return {
													bot: context.bot,
													options: {
														target: taskData.targetCrop
													}
												}
											}
										},
										on: {
											ARRIVED: {
												target: 'HARVESTING'
											},
											NAVIGATION_FAILED: 'TASK_FAILED'
										}
									},
									HARVESTING: {
										entry: 'entryHarvesting',
										invoke: {
											id: 'farmingHarvesting',
											src: 'primitiveBreaking',
											input: ({ context }: { context: MachineContext }) => {
												const taskData = context.taskData as FarmingTaskData & {
													targetCrop?: any
												}
												return {
													bot: context.bot,
													options: {
														block: taskData.targetCrop
													}
												}
											}
										},
										on: {
											BROKEN: {
												target: 'CHECKING_REPLANT',
												actions: assign({
													taskData: ({ context }) => ({
														...(context.taskData as FarmingTaskData),
														collected:
															((context.taskData as FarmingTaskData)
																.collected || 0) + 1
													})
												})
											},
											BREAKING_FAILED: 'SEARCHING_CROP'
										}
									},
									CHECKING_REPLANT: {
										always: [
											{
												guard: ({ context }: { context: MachineContext }) => {
													const taskData = context.taskData as FarmingTaskData
													return taskData.replant !== false
												},
												target: 'REPLANTING'
											},
											{
												target: 'CHECKING_GOAL'
											}
										]
									},
									REPLANTING: {
										invoke: {
											id: 'farmingReplanting',
											src: 'primitivePlacing',
											input: ({ context }: { context: MachineContext }) => {
												const taskData = context.taskData as FarmingTaskData & {
													targetCrop?: any
												}
												return {
													bot: context.bot,
													options: {
														blockName: taskData.cropName,
														position: taskData.targetCrop?.position,
														faceVector: { x: 0, y: 1, z: 0 }
													}
												}
											}
										},
										on: {
											PLACED: 'CHECKING_GOAL',
											PLACING_FAILED: 'CHECKING_GOAL'
										}
									},
									CHECKING_GOAL: {
										always: [
											{
												guard: ({ context }: { context: MachineContext }) => {
													const taskData = context.taskData as FarmingTaskData
													return (
														(taskData.collected || 0) >= (taskData.count || 1)
													)
												},
												target: 'TASK_COMPLETED'
											},
											{
												target: 'SEARCHING_CROP'
											}
										]
									},
									TASK_COMPLETED: {
										type: 'final',
										entry: 'taskFarmingCompleted'
									},
									TASK_FAILED: {
										type: 'final',
										entry: 'taskFarmingFailed'
									}
								}
							}
						}
					}
				}
			},
			MONITORING: {
				type: 'parallel',
				states: {
					HEALTH_MONITOR: {
						entry: {
							type: 'entryHealthMonitoring'
						},
						always: {
							target:
								'#MINECRAFT_BOT.MAIN_ACTIVITY.URGENT_NEEDS.EMERGENCY_HEALING',
							guard: 'isHealthCritical',
							actions: [],
							description:
								'Переход выполнится если \\\nтекущий приоритет состояния \\\nниже HEALTH_MONITOR ',
							meta: {}
						},
						on: {
							UPDATE_HEALTH: {
								actions: ['updateHealth']
							}
						}
					},
					HUNGER_MONITOR: {
						entry: {
							type: 'entryHungerMonitoring'
						},
						always: {
							target:
								'#MINECRAFT_BOT.MAIN_ACTIVITY.URGENT_NEEDS.EMERGENCY_EATING',
							guard: 'isHungerCritical',
							actions: [],
							description:
								'Переход выполнится если \\\nтекущий приоритет состояния \\\nниже HUNGER_MONITOR',
							meta: {}
						},
						on: {
							UPDATE_FOOD: {
								actions: ['updateFood']
							}
						}
					},
					ENTITIES_MONITOR: {
						entry: {
							type: 'entryEntitiesMonitoring'
						},
						always: {
							target: '#MINECRAFT_BOT.MAIN_ACTIVITY.COMBAT',
							guard: 'isEnemyNearby',
							meta: {}
						},
						on: {
							UPDATE_ENTITIES: {
								actions: ['updateEntities']
							},
							REMOVE_ENTITY: {
								actions: ['removeEntity']
							}
						},
						invoke: {
							id: 'entitiesTracking',
							src: 'serviceEntitiesTracking',
							input: ({ context }: { context: MachineContext }) => ({
								bot: context.bot
							})
						}
					},
					ARMOR_TOOLS_MONITOR: {
						entry: {
							type: 'entryArmorToolsMonitoring'
						},
						always: {
							guard: 'isBrokenArmorOrTools',
							actions: []
						}
					},
					INVENTORY_MONITOR: {
						entry: {
							type: 'entryInventoryMonitoring'
						},
						always: {
							guard: 'isInventoryFull',
							actions: []
						}
					},
					CHAT_MONITOR: {
						description: 'Команды игрока',
						entry: {
							type: 'entryChatMonitoring'
						}
					}
				}
			}
		}
	},
	{
		actions: actions as any,
		guards,
		actors
	}
)
