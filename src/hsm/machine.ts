import { createMachine } from 'xstate'
import { context } from './context'
import { actions } from './actions/index.actions'
import { guards } from './guards/index.guards'
import { actors } from './actors/index.actors'

export const machine = createMachine(
	{
		/** @xstate-layout N4IgpgJg5mDOIC5QFkCSA5AogYQEoEEAxAFQH0AhAeWIGIBlTMq4gbQAYBdRUABwHtYASwAugvgDtuIAB6IAtAEYAbACY2AOiUBmLQE42K3VoCsAFgDsJgDQgAnojML1KhSq2mVADmO7TnlQC+ATZoWHhETNQ0AKoACgAi+MSYpLGUdKjEqJTo7FxIIPxCohJSsgiKhhpsNbUKWgqOCjb2CI7Oru5ePn6BwSChOAQkFFFxicmkdEnRBFk5eVJFImKSBeWKxmzmmkp7e57e+iotDqZOLm4eR71BIRhDEaO08ZhJABKLBcsla6CtclMSg0bgU5l0ulUunM5hU5hs5QUpmMSnUQLYvgU-mMlk85juAwe4RGzHUyHwGFI+GwWQAapkAJrqWJvbCYQjRAAyZIwGAA4jRYpz8AzMLgpsRKLEvrwBCtSutEDpPOpjMq1WxrloYVpTghDKZnGx-LpjMZDJ4ap4lATBsTIsQyRT0FSaah6cQmSzqeyuepyNFUJz4vzBcLReK6JLpZwlnLfmVEOY9mjgZC2ApdN49ic7IhXMZ1NrTL5oT4YcCbf07cMHU7KdS6Yzmazfdy6JzMJhYqGhSKxRKpTLCvHVom2p4tKmlEj0Ti2A09SolLp1N5GloDCpDLjbUTa896y7G+7m962RzuYR8LhQgK+xHBzH8rLimPFQhzGZ1GCsdClHiDQeHqcjmCq2pbOaYEZgoyimHuYQHqS5INm6Hpeq2l7qIQlCcpylAAOq9uGA5RkOsbfKOCqgOUWieIaYF0SWKhmBixrGEusHqGwPjeFsJZAsmCgIY8JLUEerpNp6LY+lhdDvJgnLJLgxH9pG0bDj8740UmmrqDqpiGUY0IwqYeo6DsxhYpmGYeGaK4ifah4oceaHNrMfKYOgZBYJg8R0OomDIGKnnoNgDKkG8WToAKOGUPEpC4JgZFJfEmlUX8MiIGwepsI5SHiS5kmntJHleT5Xb+YFwW4KF4WRUkoZxQlDA3tgnwUa+8qZRsdEqGipgZlo24LguMIgV+qp1L+5rata+VPMhzrFeh6hld5pC+VVQUhV59UKfgnKhgdSnvIlyWSql6VvtRWUIDleb3QtYmOkVJ6retFV+QFO21XtEUnU1lDxVMby4O113deOcgWgNGZeNa7gQvCj2TuouiwYNxqbpYYKeM9dZvW50nYJQyDkEkNDoJQkVYGgyWQwmH5GBo6ZGEo5aqF4equABa50ZC2pKOi+LVvui2Fct73NqT5NJOorzYKgIYxTQjPaXdigc-pJgCZqejmFaPNwk4xqeILk5HIcBPOVLxNMrLFOOoryuhiwCgviON09fIyiFsNujbni66eAoBg88Nhpm9C+jQnR+Ni4hEuvXbUkO2TTsKzgruqywKie1pt0bH7RaGEHYFWaH4ePfU-jcYcMcYriCf3EnL0SdLJMZ-LwWdikSTENSADSoZeUFEXkDg+DBaQ164OrRfyMi+lWWHc2V2HyjG1i9fm+CTfxzbS2oWn6iO-LBAxX5VLEIP2Aj6rY-IBPU8z9g+EMAvPsVBY4HajxwI8aamhDzQaKovwohRMmSEX4qyt1EoTVOJV05y2duyLyKsBTUzIHQWYuBKDRHQK8NKnUvZQw-OaVcvNeiWB0MLTwEdDZTRRMiOiDQdBH0lifZB6hB50CHnQNWpDC7fyxujbcs0OZeEMtYGu3h+r7ENjqeOSJOEp24atPhAis5pAyGQTIQVBEGOQHQUgrxdEGJIQXDK44PBOD2INbcqgkTDTMDzDGOwdA6AsJqNgwstBqI7vbXh+B+EBSSrECk4obzIEoOKSUuFBERKiaQWWQpGCYC-uOOEU4lAwk1NoFQJZ5FLhqAo-YVcajmHqPBROCDbYaObFogKzVQb4BwO8GgOFCEJWalkihNQ1yWmUOCKo0ILDuJnM4EskJTTbD8LU+BTlkI5EyHE-k6gTrEDOrE9AazcAxASEkFIWyOrWO9tDRoQIjQNBYu4NUmZcwAhYjrLEWgOawUhObd5gTdn7I2ac0gfzLpCPOeQnSFQISolqLUe5DQMZ6nNEWLxehfDDVDqaOBhI26E1WZdAFhDPLimBXEw5EwUh9OETYj8mw6LcRhQuVhjyQIuAYg0ScHzMwAV8L8vF6yYqbMJQOElBz+kQrkFC+lMK4WZmaI9RQ7ypXwwxmac0wk6nLMKnylSAryqZFQMlIF2qyXHNplkLIDMqUXJpY0LYP5fzByZYHHmTCsR+C2JmQOwDeV7Pxbq7y+rDUipoElWJtIUh6s9GKzWVzCz6FUFsGVzrHpwijtZCwyYXDvL6Esgqr1tUbMjQa0xwbo0bHNtC95yIrLnDxL4JclhkVeNTeWEwWKazJzJAWgV7UkhGt9aSgAtoIcQYAy3ZT1LW3Y+wZ2KJ9f8nt7w+3BoAGZ8AADbrr4AAd3HT-H8ws-EsSXNc2dZ69i6HnX6vkZ8l1kGDbAddYAwA8D3YodGEFzIribSi39ASNV5q7QOnVN7e33uNbAAAFmAddwgwAACc307EKaHY9j0gQqgZVhmo7bxbtxFRssD-b9k0BXQAQ3g4OvdcrWiZkNOes9l6AOdoI4u5dxqABGABXQQ66IBvpBFicwMyISiahcicy2wfz0URvZHGyggj9HEHwCAcApAdpenGa14q4KolgtUx1Dzk0AjMDsXGloMReGE14X5SD0JafBZrcEnivHAhMGaScIEdBOC2DUZQ-4G7-tzSxuzZ5MJcgc0zCFNS1yOA5vGg2HF5VuB2KCS0bhA71C+bZxp0lzxtnUMrTskWNblBxPRvx0DlzGgsEoE90m-B6D0BzHE1oc3YvqcfVyp98tYVCPyEri99RFPtZmGEYIaiqqeYgKdbr6IFjUH4zUOXus8N636AMQZMGDe-jHAaDyAIsVxHVmug1YuNDDsCVh2x2sacQbljCsk-Qdi7D2GKO3xymYPUiKBwJ6LJknQ0Br82WKLauytlaYWntXhiQNyi2m7p7YzCiQwm59CuAYfKsOhZQTgkhDuWEAEIed0exeP0OE8KETh11KLd0sSFkMg85QeJysQnMvYmcqLYJFMsJYYnwT1vtgUkpMU1OyG0-KOltE1S23DQ5gcQHTg5vnFBzh5bzH8Ohby+F7kkHBCwGEB9j8WJ+reHOPFvxiWJqoi-H5sEKJ3CsP56fT6m1Kp0CN+K4Tq4UVudVZ55LhklWNDyeCWVzueGu62j9GqdUIpRTFyI6GhsnC+4XP73UWPXDB8MLatVEePp-Q2tH6qu0woAzeEdd78PHMbBTz+v3HnM+tG-SJvENXDLggLzLbuxBPea3NKiCyACMzQSS60Q4qJA5uG2GbrExpu9d1QVnJW22a8S8QPoTQehzSrwxMYOtPNZ-iNBCxCteTF8oMzoQPuifqXRaMPpNQFpzaI06BHUwU5lQmX8JuUOotgtNcHsz5e8yRFIuwb474H4+R+8NgM0ixJwMZ5Fa5pFQFoRNBYR44LA+p1VAD7tVtVpz5HRL5PIEoB5h478Ec4DJpkRlA4QMUTBtweY-x+ZX9KsD9JxjBL8QDl9XhCAMFKDa9EBUdnBMCwRTRLgdAeZB80RtwBZzhA5rNuDmlYD5AAI41YIUdMwzAY53F6g1xbdNxVBO9txlDQltFzF0hMhSBjEPd19Ss1DFUYQ8QSwPlHEUZWg1Bl4WcFxlQAImszCwl1BklUBolbw4lSAElOQ7CacHCKhtAdgMYQ8XBTQSxwROI0YCx08uh6IuCNd8DIdpJmlsJgYWo3gOlVD4igdtgUdDIDQeIPDhCcY0QD92VNRqkMxuC9cDdKjA5VwxMIQ-FgQUieYjhuJzhYQstbVzgr1+UYD7ChtNgsx7UDMwInVpsKhNwpxJs4QHkMQ9AwRZiQNNlK9tliNLpKjKg64WIcNfBoFYEQId4OCfBWJQ4zAfl8jnJu0b13ghViVtVLiMcGIsQMVasywTtnlGhmFU0YIvkeVPiVlgNC0A0LUS0ASFjv4ripwbi-E7iVwHiU1jRpkLAw5lws1jCjjCM71zi4lATdjnBHdDIwSCTWhHdS5LRYQ3AVxdNFMAggA */
		id: 'MINECRAFT_BOT',
		type: 'parallel',
		predictableActionArguments: true,
		preserveActionOrder: true,
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
				target: '#MINECRAFT_BOT.MAIN_ACTIVITY.PEACEFUL.IDLE',
				actions: ['updateAfterDeath']
			}
		},
		states: {
			MAIN_ACTIVITY: {
				initial: 'PEACEFUL',
				states: {
					PEACEFUL: {
						description:
							'Переход в эти состояния по командам игрока (приоритеты 7 - 9)',
						initial: 'IDLE',
						states: {
							IDLE: {
								description: 'Приоритет 1',
								entry: {
									type: 'entryIdle'
								}
							},
							MINING: {
								description: 'Приоритет 7',
								entry: {
									type: 'entryMining'
								},
								exit: [
									{
										type: 'exitMining'
									},
									{
										type: 'saveMiningProgress'
									}
								],
								on: {
									PLAYER_STOP: [
										{
											target: 'IDLE',
											actions: [
												{
													type: 'saveMiningProgress'
												}
											]
										}
									]
								}
							},
							BUILDING: {
								description: 'Приоритет 7',
								entry: {
									type: 'entryBuilding'
								},
								exit: [
									{
										type: 'exitBuilding'
									},
									{
										type: 'saveBuildingProgress'
									}
								],
								on: {
									PLAYER_STOP: [
										{
											target: 'IDLE',
											actions: [
												{
													type: 'saveBuildingProgress'
												}
											],
											meta: {}
										}
									]
								}
							},
							SLEEPING: {
								description: 'Приоритет 7',
								entry: {
									type: 'entrySleeping'
								},
								exit: {
									type: 'exitSleeping'
								},
								on: {
									PLAYER_STOP: [
										{
											target: 'IDLE',
											actions: []
										}
									]
								}
							},
							FARMING: {
								description: 'Приоритет 7',
								entry: {
									type: 'entryFarming'
								},
								exit: [
									{
										type: 'exitFarming'
									},
									{
										type: 'saveFarmingProgress'
									}
								],
								on: {
									PLAYER_STOP: [
										{
											target: 'IDLE',
											actions: [
												{
													type: 'saveFarmingProgress'
												}
											]
										}
									]
								}
							},
							FOLLOWING: {
								description: 'Приоритет 9',
								entry: {
									type: 'entryFollowing'
								},
								exit: {
									type: 'exitFollowing'
								},
								on: {
									PLAYER_STOP: [
										{
											target: 'IDLE',
											actions: []
										}
									]
								}
							},
							SHELTERING: {
								description: 'Приоритет 7',
								entry: {
									type: 'entrySheltering'
								},
								exit: {
									type: 'exitSheltering'
								},
								on: {
									PLAYER_STOP: [
										{
											target: 'IDLE',
											actions: []
										}
									]
								}
							},
							hist: {
								history: 'shallow',
								type: 'history'
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
									input: ({ context }) => ({ context })
								},
								on: {
									FOOD_RESTORED: {
										target: '#MINECRAFT_BOT.MAIN_ACTIVITY.hist'
									},
									FOOD_SEARCH: {
										target: '#MINECRAFT_BOT.MAIN_ACTIVITY.TASKS.FOOD_SEAECH'
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
									input: ({ context }) => ({ context })
								},
								on: {
									HEALTH_RESTORED: {
										target: '#MINECRAFT_BOT.MAIN_ACTIVITY.hist'
									},
									FOOD_SEARCH: {
										target: '#MINECRAFT_BOT.MAIN_ACTIVITY.TASKS.FOOD_SEAECH'
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
									input: ({ context }) => ({ context })
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
									input: ({ context }) => ({ context })
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
									input: ({ context }) => ({ context })
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
					TASKS: {
						description: 'Задачи бота',
						initial: 'DEPOSIT_ITEMS',
						states: {
							DEPOSIT_ITEMS: {
								description: 'Выкладывание вещей в сундук',
								on: {
									ITEMS_DEPOSITED: [
										{
											target: '#MINECRAFT_BOT.MAIN_ACTIVITY.hist',
											actions: []
										}
									]
								}
							},
							REPAIR_ARMOR_TOOLS: {
								description: 'Починка брони и инструментов',
								on: {
									REPAIR_COMPLETE: [
										{
											target: '#MINECRAFT_BOT.MAIN_ACTIVITY.hist',
											actions: []
										}
									]
								}
							},
							FOOD_SEAECH: {
								description: 'Поиск еды',
								entry: {
									type: 'entrySearchFood'
								},
								on: {
									FOUND_FOOD: [
										{
											target: '#MINECRAFT_BOT.MAIN_ACTIVITY.hist',
											actions: []
										}
									]
								}
							}
						},
						always: {
							target: 'hist',
							guard: 'noTasks',
							actions: []
						}
					},

					hist: {
						history: 'shallow',
						type: 'history'
					}
				}
			},
			MONITORING: {
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
					// "ARMOR_TOOLS_MONITOR": {
					//   entry: {
					//     type: "entryArmorToolsMonitoring"
					//   },
					//   always: {
					//     target: "#MINECRAFT_BOT.MAIN_ACTIVITY.TASKS.REPAIR_ARMOR_TOOLS",
					//     guard: "isBrokenArmorOrTools",
					//     actions: []
					//   }
					// },
					// "INVENTORY_MONITOR": {
					//   entry: {
					//     type: "entryInventoryMonitoring"
					//   },
					//   always: {
					//     target: "#MINECRAFT_BOT.MAIN_ACTIVITY.TASKS.DEPOSIT_ITEMS",
					//     guard: "isInventoryFull",
					//     actions: []
					//   }
					// },
					CHAT_MONITOR: {
						description: 'Команды игрока',
						entry: {
							type: 'entryChatMonitoring'
						},
						on: {
							mine: [
								{
									target: '#MINECRAFT_BOT.MAIN_ACTIVITY.PEACEFUL.MINING',
									actions: []
								}
							],
							follow: [
								{
									target: '#MINECRAFT_BOT.MAIN_ACTIVITY.PEACEFUL.FOLLOWING',
									actions: []
								}
							],
							sleep: [
								{
									target: '#MINECRAFT_BOT.MAIN_ACTIVITY.PEACEFUL.SLEEPING',
									actions: []
								}
							],
							shelter: [
								{
									target: '#MINECRAFT_BOT.MAIN_ACTIVITY.PEACEFUL.SHELTERING',
									actions: []
								}
							],
							farm: [
								{
									target: '#MINECRAFT_BOT.MAIN_ACTIVITY.PEACEFUL.FARMING',
									actions: []
								}
							],
							build: [
								{
									target: '#MINECRAFT_BOT.MAIN_ACTIVITY.PEACEFUL.BUILDING',
									actions: []
								}
							]
						}
					}
				},
				type: 'parallel'
			}
		}
	},
	{
		actions,
		guards,
		actors,
		delays: {}
	}
)
