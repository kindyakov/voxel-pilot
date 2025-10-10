import { createMachine, assign } from 'xstate'
import type { MachineEvent } from '@hsm/types'
import { context, type MachineContext } from '@hsm/context'
import type { AnyTaskData, MiningTaskData } from '@hsm/tasks/index'
import { actions } from '@hsm/actions/index.actions'
import { guards } from '@hsm/guards/index.guards'
import { actors } from '@hsm/actors/index.actors'

export const machine = createMachine(
	{
		types: {} as {
			context: MachineContext
			events: MachineEvent
		},
		id: 'MINECRAFT_BOT',
		type: 'parallel',
		context,
		on: {
			SET_BOT: {
				actions: ['setBot']
			},
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
										context
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
										context
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
										context
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
										guard: 'canUseRanged'
									}
								},
								invoke: {
									id: 'meleeAttack',
									src: 'serviceMeleeAttack',
									input: ({ context }: { context: MachineContext }) => ({
										context
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
										context
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
								initial: 'SEARCHING',

								states: {
									CHECKING_PRECONDITIONS: {
										entry: {
											type: 'entryCheckingPreconditions'
										},
										exit: {
											type: 'exitCheckingPreconditions'
										},
										on: {
											SUCCESSFULLY: 'SEARCHING'
										}
									},
									SEARCHING: {
										invoke: {
											id: 'miningSearching',
											src: 'primitiveSearchBlock',
											input: ({ context }: { context: MachineContext }) => ({
												context,
												options: {
													blockName: (context.taskData as MiningTaskData)
														.blockName,
													count: (context.taskData as MiningTaskData).count
												}
											})
										},
										on: {
											FOUND: {
												target: 'NAVIGATING',
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
									NAVIGATING: {
										invoke: {
											id: 'miningNavigating',
											src: 'primitiveNavigating',
											input: ({ context }: { context: MachineContext }) => ({
												context,
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
												context,
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
										type: 'final'
									},

									TASK_FAILED: {
										type: 'final'
									}
								}
							},

							SMELTING: {},
							CRAFTING: {}
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
							actions: ['setTargetOnEnemy'],
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
							src: 'serviceEntitiesTracking'
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
