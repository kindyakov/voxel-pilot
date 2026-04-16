import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'

import { createActor, fromPromise } from 'xstate'

import { createBotMachine } from '../../hsm/machine.js'

const createVec3 = (x: number, y: number, z: number) => ({
	x,
	y,
	z,
	distanceTo(other: { x: number; y: number; z: number }) {
		const dx = x - other.x
		const dy = y - other.y
		const dz = z - other.z
		return Math.sqrt(dx * dx + dy * dy + dz * dz)
	},
	offset(dx: number, dy: number, dz: number) {
		return createVec3(x + dx, y + dy, z + dz)
	},
	minus(other: { x: number; y: number; z: number }) {
		return {
			x: x - other.x,
			y: y - other.y,
			z: z - other.z,
			normalize() {
				const length = Math.sqrt(
					this.x * this.x + this.y * this.y + this.z * this.z
				)
				return createVec3(this.x / length, this.y / length, this.z / length)
			}
		}
	}
})

class FakeBot extends EventEmitter {
	username = 'Bot'
	entity = { id: 999, position: createVec3(0, 64, 0), height: 1.8 }
	entities = {}
	health = 20
	food = 20
	foodSaturation = 5
	oxygenLevel = 20
	inventory = {
		slots: Array.from({ length: 46 }, () => null),
		items: () => []
	}
	registry = {
		isNewerOrEqualTo: () => true
	}
	movement = {
		goals: {
			Default: { id: 'default-goal' }
		},
		heuristic: {
			get: () => ({
				target: () => ({
					avoid: () => {}
				}),
				avoid: () => {}
			})
		},
		setGoal: () => {},
		getYaw: () => 0,
		steer: async () => {}
	}
	game = { dimension: 'overworld' }
	time = { isDay: true, timeOfDay: 1000 }
	autoEat = {
		foodsByName: {},
		opts: { bannedFood: [] },
		findBestChoices: () => [],
		isEating: false
	}
	pathfinder = {
		goals: [] as unknown[],
		setGoal: (goal: unknown) => {
			this.pathfinder.goals.push(goal)
		}
	}
	movements = {
		allowSprinting: true
	}
	controlStates = new Map<string, boolean>()
	pvpAttackCalls = 0
	pvpStopCalls = 0
	pvpForceStopCalls = 0
	hawkEyeStopCalls = 0
	hawkEyeAttackCalls = 0
	hawkEye = {
		stop: () => {
			this.hawkEyeStopCalls += 1
		},
		autoAttack: () => {
			this.hawkEyeAttackCalls += 1
		}
	}
	tool = {
		equipForBlock: async () => {}
	}
	armorManager = {}
	pvp = {
		target: undefined as any,
		attack: (enemy?: any) => {
			this.pvpAttackCalls += 1
			this.pvp.target = enemy
		},
		stop: () => {
			this.pvpStopCalls += 1
			this.pvp.target = undefined
		},
		forceStop: () => {
			this.pvpForceStopCalls += 1
			this.pvp.target = undefined
		}
	}
	utils = {
		getAllFood: () => [{ name: 'bread' }],
		eating: async () => {},
		stopEating: () => {},
		findNearestEnemy: () => null,
		getMeleeWeapon: () => null,
		getRangeWeapon: () => null,
		getArrow: () => null,
		searchPlayer: () => null,
		countItemInInventory: () => 0
	}
	memory = {
		load: async () => {},
		save: async () => {},
		close: () => {},
		readEntries: () => [],
		saveEntry: () => null,
		updateEntryData: () => null,
		deleteEntry: () => false
	}
	hsm: any
	chatMessages: string[] = []

	chat(message: string) {
		this.chatMessages.push(message)
	}
	quit() {}
	loadPlugin() {}
	async dig() {}
	async placeBlock() {}
	async equip() {}
	async consume() {}
	async craft() {}
	recipesFor() {
		return []
	}
	async sleep() {}
	blockAt() {
		return null
	}
	findBlocks() {
		return []
	}
	nearestEntity() {
		return null
	}
	getEquipmentDestSlot() {
		return 36
	}
	async openChest() {
		return {
			slots: [],
			close() {},
			containerItems() {
				return []
			},
			findItemRangeName() {
				return null
			}
		}
	}
	async openContainer() {
		return {
			slots: [],
			close() {},
			containerItems() {
				return []
			},
			findItemRangeName() {
				return null
			}
		}
	}
	async openFurnace() {
		return {
			slots: [],
			close() {},
			containerItems() {
				return []
			},
			findItemRangeName() {
				return null
			}
		}
	}
	async openBlock() {
		return {
			slots: [],
			close() {},
			containerItems() {
				return []
			},
			findItemRangeName() {
				return null
			}
		}
	}
	async transfer() {}
	closeWindow() {}
	setControlState(control: string, state: boolean) {
		this.controlStates.set(control, state)
	}
}

const hangingActor = fromPromise(async () => {
	return await new Promise<never>(() => {})
})

const noopActor = fromPromise(async () => {})

const enemy = {
	id: 1,
	type: 'hostile',
	name: 'zombie',
	position: createVec3(2, 64, 0),
	isValid: true
}

const createTestActor = () => {
	const bot = new FakeBot() as any
	const actor = createActor(
		createBotMachine({
			thinkingActor: hangingActor,
			actors: {
				serviceEntitiesTracking: noopActor,
				serviceApproaching: noopActor,
				serviceMeleeAttack: noopActor,
				serviceRangedSkirmish: noopActor,
				serviceFleeing: noopActor,
				serviceEmergencyEating: hangingActor,
				serviceEmergencyHealing: hangingActor
			}
		}),
		{
			input: { bot }
		}
	)

	bot.hsm = {
		getContext: () => actor.getSnapshot().context
	}

	actor.start()
	return { bot, actor }
}

const waitForTurn = async () => {
	await delay(0)
	await delay(0)
}

const waitUntil = async (predicate: () => boolean, attempts = 40) => {
	for (let attempt = 0; attempt < attempts; attempt += 1) {
		await delay(25)
		if (predicate()) {
			return
		}
	}
}

test('machine enters TASKS.THINKING on USER_COMMAND', async () => {
	const { actor } = createTestActor()

	try {
		actor.send({
			type: 'USER_COMMAND',
			username: 'Steve',
			text: 'Build a shelter'
		})
		await waitForTurn()

		assert.equal(
			actor
				.getSnapshot()
				.matches({ MAIN_ACTIVITY: { TASKS: 'THINKING' } } as never),
			true
		)
	} finally {
		actor.stop()
	}
})

test('combat returns to TASKS.THINKING when a goal exists', async () => {
	const { actor } = createTestActor()

	try {
		actor.send({
			type: 'USER_COMMAND',
			username: 'Steve',
			text: 'Follow the target'
		})
		await waitForTurn()

		actor.send({
			type: 'START_COMBAT',
			target: enemy as any
		})
		await waitForTurn()

		assert.equal(
			actor.getSnapshot().matches({ MAIN_ACTIVITY: 'COMBAT' } as never),
			true
		)

		actor.send({ type: 'NO_ENEMIES' })
		await waitForTurn()

		assert.equal(
			actor
				.getSnapshot()
				.matches({ MAIN_ACTIVITY: { TASKS: 'THINKING' } } as never),
			true
		)
	} finally {
		actor.stop()
	}
})

test('combat returns to IDLE when there is no active goal', async () => {
	const { actor } = createTestActor()

	try {
		actor.send({
			type: 'START_COMBAT',
			target: enemy as any
		})
		await waitForTurn()

		assert.equal(
			actor.getSnapshot().matches({ MAIN_ACTIVITY: 'COMBAT' } as never),
			true
		)

		actor.send({ type: 'NO_ENEMIES' })
		await waitForTurn()

		assert.equal(
			actor.getSnapshot().matches({ MAIN_ACTIVITY: 'IDLE' } as never),
			true
		)
	} finally {
		actor.stop()
	}
})

test('START_COMBAT seeds nearestEnemy from the event target', async () => {
	const { actor } = createTestActor()

	try {
		actor.send({
			type: 'START_COMBAT',
			target: enemy as any
		})
		await waitForTurn()

		assert.equal(actor.getSnapshot().context.nearestEnemy.entity, enemy)
		assert.equal(actor.getSnapshot().context.nearestEnemy.distance, 2)
	} finally {
		actor.stop()
	}
})

test('STOP_COMBAT returns to TASKS.THINKING when a goal exists', async () => {
	const { actor } = createTestActor()

	try {
		actor.send({
			type: 'USER_COMMAND',
			username: 'Steve',
			text: 'Follow the target'
		})
		await waitForTurn()

		actor.send({
			type: 'START_COMBAT',
			target: enemy as any
		})
		await waitForTurn()

		assert.equal(
			actor.getSnapshot().matches({ MAIN_ACTIVITY: 'COMBAT' } as never),
			true
		)

		actor.send({ type: 'STOP_COMBAT' })
		await waitForTurn()

		assert.equal(
			actor
				.getSnapshot()
				.matches({ MAIN_ACTIVITY: { TASKS: 'THINKING' } } as never),
			true
		)
	} finally {
		actor.stop()
	}
})

test('STOP_COMBAT suppresses auto re-entry into combat until enemies are gone', async () => {
	const { actor } = createTestActor()

	try {
		actor.send({
			type: 'START_COMBAT',
			target: enemy as any
		})
		await waitForTurn()

		actor.send({ type: 'STOP_COMBAT' })
		await waitForTurn()

		actor.send({
			type: 'UPDATE_ENTITIES',
			entities: [enemy as any],
			enemies: [enemy as any],
			players: [],
			nearestEnemy: {
				entity: enemy as any,
				distance: 2
			}
		})
		await waitForTurn()

		assert.equal(
			actor.getSnapshot().matches({ MAIN_ACTIVITY: 'IDLE' } as never),
			true
		)
	} finally {
		actor.stop()
	}
})

test('autoDefend false prevents entity updates from forcing combat entry', async () => {
	const bot = new FakeBot() as any
	const actor = createActor(
		createBotMachine({
			thinkingActor: hangingActor,
			actors: {
				serviceEntitiesTracking: noopActor,
				serviceApproaching: noopActor,
				serviceMeleeAttack: noopActor,
				serviceRangedSkirmish: noopActor,
				serviceFleeing: noopActor,
				serviceEmergencyEating: hangingActor,
				serviceEmergencyHealing: hangingActor
			}
		}),
		{
			input: { bot }
		}
	)

	bot.hsm = {
		getContext: () => actor.getSnapshot().context
	}

	actor.start()

	try {
		actor.getSnapshot().context.preferences.autoDefend = false
		actor.send({
			type: 'UPDATE_ENTITIES',
			entities: [enemy as any],
			enemies: [enemy as any],
			players: [],
			nearestEnemy: {
				entity: enemy as any,
				distance: 2
			}
		})
		await waitForTurn()

		assert.equal(
			actor.getSnapshot().matches({ MAIN_ACTIVITY: 'IDLE' } as never),
			true
		)
	} finally {
		actor.stop()
	}
})

test('NO_ENEMIES clears nearestEnemy before returning to thinking', async () => {
	const { actor } = createTestActor()

	try {
		actor.send({
			type: 'USER_COMMAND',
			username: 'Steve',
			text: 'Follow the target'
		})
		await waitForTurn()

		actor.send({
			type: 'START_COMBAT',
			target: enemy as any
		})
		await waitForTurn()

		actor.send({ type: 'NO_ENEMIES' })
		await waitForTurn()

		assert.equal(actor.getSnapshot().context.nearestEnemy.entity, null)
		assert.equal(actor.getSnapshot().context.nearestEnemy.distance, Infinity)
	} finally {
		actor.stop()
	}
})

test('combat falls back to APPROACHING when no immediate attack mode is valid', async () => {
	const { actor } = createTestActor()

	try {
		actor.send({
			type: 'START_COMBAT',
			target: {
				...enemy,
				position: createVec3(12, 64, 0)
			} as any
		})
		await waitForTurn()

		assert.equal(
			actor.getSnapshot().matches({
				MAIN_ACTIVITY: { COMBAT: 'APPROACHING' }
			} as never),
			true
		)
		assert.equal(actor.getSnapshot().context.movementOwner, 'PATHFINDER')
	} finally {
		actor.stop()
	}
})

test('combat chooses RANGED_SKIRMISHING when ranged window is valid', async () => {
	const bot = new FakeBot() as any
	bot.utils.getRangeWeapon = () => ({ name: 'bow' })
	bot.utils.getArrow = () => ({ name: 'arrow' })

	const actor = createActor(
		createBotMachine({
			thinkingActor: hangingActor,
			actors: {
				serviceEntitiesTracking: noopActor,
				serviceApproaching: noopActor,
				serviceMeleeAttack: noopActor,
				serviceRangedSkirmish: noopActor,
				serviceFleeing: noopActor,
				serviceEmergencyEating: hangingActor,
				serviceEmergencyHealing: hangingActor
			}
		}),
		{
			input: { bot }
		}
	)

	bot.hsm = {
		getContext: () => actor.getSnapshot().context
	}

	actor.start()

	try {
		actor.send({
			type: 'START_COMBAT',
			target: {
				...enemy,
				position: createVec3(12, 64, 0)
			} as any
		})
		await waitForTurn()

		assert.equal(
			actor.getSnapshot().matches({
				MAIN_ACTIVITY: { COMBAT: 'RANGED_SKIRMISHING' }
			} as never),
			true
		)
		assert.equal(actor.getSnapshot().context.movementOwner, 'MOVEMENT')
	} finally {
		actor.stop()
	}
})

test('combat chooses MELEE_ATTACKING in close range and assigns pvp ownership', async () => {
	const { actor } = createTestActor()

	try {
		actor.send({
			type: 'START_COMBAT',
			target: enemy as any
		})
		await waitForTurn()

		assert.equal(
			actor.getSnapshot().matches({
				MAIN_ACTIVITY: { COMBAT: 'MELEE_ATTACKING' }
			} as never),
			true
		)
		assert.equal(actor.getSnapshot().context.movementOwner, 'PVP')
	} finally {
		actor.stop()
	}
})

test(
	'combat keeps the current target locked instead of retargeting every monitor tick',
	async () => {
		const bot = new FakeBot() as any
		bot.utils.getRangeWeapon = () => ({ name: 'bow' })
		bot.utils.getArrow = () => ({ name: 'arrow' })

		const actor = createActor(
			createBotMachine({
				thinkingActor: hangingActor,
				actors: {
					serviceEntitiesTracking: noopActor,
					serviceApproaching: noopActor,
					serviceMeleeAttack: noopActor,
					serviceRangedSkirmish: noopActor,
					serviceFleeing: noopActor,
					serviceEmergencyEating: hangingActor,
					serviceEmergencyHealing: hangingActor
				}
			}),
			{
				input: { bot }
			}
		)

		bot.hsm = {
			getContext: () => actor.getSnapshot().context
		}

		actor.start()
		const enemyA = {
			...enemy,
			id: 101,
			position: createVec3(8, 64, 0)
		}
		const enemyB = {
			...enemy,
			id: 102,
			position: createVec3(6, 64, 0)
		}

		try {
			actor.send({
				type: 'START_COMBAT',
				target: enemyA as any
			})
			await waitForTurn()
			await waitForTurn()

			assert.equal(
				actor.getSnapshot().matches({
					MAIN_ACTIVITY: 'COMBAT'
				} as never),
				true
			)
			assert.equal(actor.getSnapshot().context.preferredCombatTargetId, enemyA.id)

			actor.send({
				type: 'UPDATE_ENTITIES',
				entities: [enemyA as any, enemyB as any],
				enemies: [enemyA as any, enemyB as any],
				players: [],
				nearestEnemy: {
					entity: enemyB as any,
					distance: 6
				}
			})
			await waitForTurn()

			assert.equal(actor.getSnapshot().context.preferredCombatTargetId, enemyA.id)
			assert.equal(actor.getSnapshot().context.nearestEnemy.entity?.id, enemyA.id)
		} finally {
			actor.stop()
		}
	}
)

test(
	'melee combat does not thrash into ranged skirmish on small distance jitter',
	async () => {
		const bot = new FakeBot() as any
		bot.utils.getRangeWeapon = () => ({ name: 'bow' })
		bot.utils.getArrow = () => ({ name: 'arrow' })

		const actor = createActor(
			createBotMachine({
				thinkingActor: hangingActor,
				actors: {
					serviceEntitiesTracking: noopActor,
					serviceApproaching: noopActor,
					serviceMeleeAttack: noopActor,
					serviceRangedSkirmish: noopActor,
					serviceFleeing: noopActor,
					serviceEmergencyEating: hangingActor,
					serviceEmergencyHealing: hangingActor
				}
			}),
			{
				input: { bot }
			}
		)

		bot.hsm = {
			getContext: () => actor.getSnapshot().context
		}

		actor.start()

		try {
			actor.send({
				type: 'START_COMBAT',
				target: enemy as any
			})
			await waitForTurn()

			assert.equal(
				actor.getSnapshot().matches({
					MAIN_ACTIVITY: { COMBAT: 'MELEE_ATTACKING' }
				} as never),
				true
			)

			actor.send({
				type: 'UPDATE_ENTITIES',
				entities: [
					{
						...enemy,
						position: createVec3(5.2, 64, 0)
					} as any
				],
				enemies: [
					{
						...enemy,
						position: createVec3(5.2, 64, 0)
					} as any
				],
				players: [],
				nearestEnemy: {
					entity: {
						...enemy,
						position: createVec3(5.2, 64, 0)
					} as any,
					distance: 5.2
				}
			})
			await waitForTurn()

			assert.equal(
				actor.getSnapshot().matches({
					MAIN_ACTIVITY: { COMBAT: 'MELEE_ATTACKING' }
				} as never),
				true
			)
		} finally {
			actor.stop()
		}
	}
)

test('urgent needs returns to TASKS.THINKING when a goal exists', async () => {
	const { actor } = createTestActor()

	try {
		actor.send({
			type: 'USER_COMMAND',
			username: 'Steve',
			text: 'Gather wood'
		})
		await waitForTurn()

		actor.send({
			type: 'START_URGENT_NEEDS',
			need: 'food'
		})
		await waitForTurn()

		assert.equal(
			actor.getSnapshot().matches({ MAIN_ACTIVITY: 'URGENT_NEEDS' } as never),
			true
		)

		actor.send({ type: 'FOOD_RESTORED' })
		await waitForTurn()

		assert.equal(
			actor
				.getSnapshot()
				.matches({ MAIN_ACTIVITY: { TASKS: 'THINKING' } } as never),
			true
		)
	} finally {
		actor.stop()
	}
})

test('urgent needs returns to IDLE when there is no active goal', async () => {
	const { actor } = createTestActor()

	try {
		actor.send({
			type: 'START_URGENT_NEEDS',
			need: 'health'
		})
		await waitForTurn()

		assert.equal(
			actor.getSnapshot().matches({ MAIN_ACTIVITY: 'URGENT_NEEDS' } as never),
			true
		)

		actor.send({ type: 'HEALTH_RESTORED' })
		await waitForTurn()

		assert.equal(
			actor.getSnapshot().matches({ MAIN_ACTIVITY: 'IDLE' } as never),
			true
		)
	} finally {
		actor.stop()
	}
})

test(
	'UPDATE_HEALTH preempts combat into urgent healing while a melee threat is active',
	async () => {
		const { actor } = createTestActor()

		try {
			actor.send({
				type: 'START_COMBAT',
				target: enemy as any
			})
			await waitForTurn()
			await waitForTurn()

			assert.equal(
				actor
					.getSnapshot()
					.matches({ MAIN_ACTIVITY: { COMBAT: 'MELEE_ATTACKING' } } as never),
				true
			)

			actor.send({
				type: 'UPDATE_HEALTH',
				health: 8
			})
			await waitForTurn()
			await waitForTurn()

			assert.equal(actor.getSnapshot().context.health, 8)
			assert.equal(
				actor.getSnapshot().matches({
					MAIN_ACTIVITY: { URGENT_NEEDS: 'EMERGENCY_HEALING' }
				} as never),
				true
			)
		} finally {
			actor.stop()
		}
	}
)

test(
	'UPDATE_FOOD preempts into urgent eating even when a hostile is already nearby',
	async () => {
		const { actor } = createTestActor()

		try {
			actor.send({
				type: 'UPDATE_ENTITIES',
				entities: [enemy as any],
				enemies: [enemy as any],
				players: [],
				nearestEnemy: {
					entity: enemy as any,
					distance: 2
				}
			})
			await waitForTurn()
			await waitForTurn()

			actor.send({
				type: 'UPDATE_FOOD',
				food: 5
			})
			await waitForTurn()
			await waitForTurn()

			assert.equal(
				actor.getSnapshot().matches({
					MAIN_ACTIVITY: { URGENT_NEEDS: 'EMERGENCY_EATING' }
				} as never),
				true
			)
		} finally {
			actor.stop()
		}
	}
)

test(
	'URGENT_NEEDS remains sticky on UPDATE_ENTITIES while emergency recovery is unresolved',
	async () => {
		const { actor } = createTestActor()

		try {
			actor.send({
				type: 'START_COMBAT',
				target: enemy as any
			})
			await waitForTurn()
			await waitForTurn()

			actor.send({
				type: 'UPDATE_HEALTH',
				health: 8
			})
			await waitForTurn()
			await waitForTurn()

			assert.equal(
				actor.getSnapshot().matches({
					MAIN_ACTIVITY: { URGENT_NEEDS: 'EMERGENCY_HEALING' }
				} as never),
				true
			)

			actor.send({
				type: 'UPDATE_ENTITIES',
				entities: [enemy as any],
				enemies: [enemy as any],
				players: [],
				nearestEnemy: {
					entity: enemy as any,
					distance: 2
				}
			})
			await waitForTurn()
			await waitForTurn()

			assert.equal(
				actor.getSnapshot().matches({
					MAIN_ACTIVITY: { URGENT_NEEDS: 'EMERGENCY_HEALING' }
				} as never),
				true
			)
		} finally {
			actor.stop()
		}
	}
)

test(
	'URGENT_NEEDS returns to history instead of routing through COMBAT when recovery completes',
	async () => {
		const { actor } = createTestActor()

		try {
			actor.send({
				type: 'USER_COMMAND',
				username: 'Steve',
				text: 'Gather wood'
			})
			await waitForTurn()
			await waitForTurn()

			actor.send({
				type: 'UPDATE_HEALTH',
				health: 8
			})
			await waitForTurn()
			await waitForTurn()

			assert.equal(
				actor.getSnapshot().matches({
					MAIN_ACTIVITY: { URGENT_NEEDS: 'EMERGENCY_HEALING' }
				} as never),
				true
			)

			actor.send({ type: 'HEALTH_RESTORED' })
			await waitForTurn()
			await waitForTurn()

			assert.equal(
				actor.getSnapshot().matches({
					MAIN_ACTIVITY: { TASKS: 'THINKING' }
				} as never),
				true
			)
		} finally {
			actor.stop()
		}
	}
)

test(
	'melee attack is reissued when the pvp controller silently loses the target',
	async () => {
		const bot = new FakeBot() as any
		bot.utils.getMeleeWeapon = () => ({ name: 'iron_sword' })

		const actor = createActor(
			createBotMachine({
				thinkingActor: hangingActor,
				actors: {
					serviceEntitiesTracking: noopActor,
					serviceApproaching: noopActor,
					serviceRangedSkirmish: noopActor,
					serviceFleeing: noopActor,
					serviceEmergencyEating: hangingActor,
					serviceEmergencyHealing: hangingActor
				}
			}),
			{
				input: { bot }
			}
		)

		bot.hsm = {
			getContext: () => actor.getSnapshot().context
		}

		actor.start()

		try {
			actor.send({
				type: 'START_COMBAT',
				target: enemy as any
			})
			await waitForTurn()
			await waitForTurn()

			assert.equal(
				actor.getSnapshot().matches({
					MAIN_ACTIVITY: { COMBAT: 'MELEE_ATTACKING' }
				} as never),
				true
			)
			await waitUntil(() => bot.pvpAttackCalls > 0)
			assert.equal(bot.pvpAttackCalls > 0, true)
			assert.equal(bot.pvp.target?.id, enemy.id)

			bot.pvp.target = undefined
			await waitUntil(() => bot.pvpAttackCalls >= 2)

			assert.equal(bot.pvpAttackCalls >= 2, true)
			assert.equal(bot.pvp.target?.id, enemy.id)
		} finally {
			actor.stop()
		}
	}
)

test(
	'combat-to-urgent handoff force stops pvp before survival takes ownership',
	async () => {
		const bot = new FakeBot() as any
		bot.utils.getMeleeWeapon = () => ({ name: 'iron_sword' })
		bot.pvp.stop = async () => {
			bot.pvpStopCalls += 1
			await delay(0)
			bot.pathfinder.setGoal(null)
			bot.pvp.target = undefined
		}
		bot.pvp.forceStop = () => {
			bot.pvpForceStopCalls += 1
			bot.pvp.target = undefined
		}

		const actor = createActor(
			createBotMachine({
				thinkingActor: hangingActor,
				actors: {
					serviceEntitiesTracking: noopActor,
					serviceApproaching: noopActor,
					serviceRangedSkirmish: noopActor,
					serviceEmergencyEating: hangingActor,
					serviceEmergencyHealing: hangingActor
				}
			}),
			{
				input: { bot }
			}
		)

		bot.hsm = {
			getContext: () => actor.getSnapshot().context
		}

		actor.start()

		try {
			actor.send({
				type: 'START_COMBAT',
				target: enemy as any
			})
			await waitForTurn()
			await waitForTurn()

			assert.equal(
				actor.getSnapshot().matches({
					MAIN_ACTIVITY: { COMBAT: 'MELEE_ATTACKING' }
				} as never),
				true
			)

			actor.send({
				type: 'UPDATE_HEALTH',
				health: 8
			})
			await waitForTurn()
			await waitForTurn()
			await delay(10)

			assert.equal(
				actor.getSnapshot().matches({
					MAIN_ACTIVITY: { URGENT_NEEDS: 'EMERGENCY_HEALING' }
				} as never),
				true
			)
			assert.equal(bot.pvpForceStopCalls > 0, true)
		} finally {
			actor.stop()
		}
	}
)

test(
	'emergency healing does not start eating when a live hostile is already within melee range',
	async () => {
		const hostileAtMeleeRange = {
			...enemy,
			id: 77,
			position: createVec3(1, 64, 0)
		}
		let eatingCalls = 0

		const bot = new FakeBot() as any
		bot.health = 8
		bot.utils = {
			...bot.utils,
			findNearestEnemy: () => hostileAtMeleeRange,
			eating: async () => {
				eatingCalls += 1
			}
		}

		const actor = createActor(
			createBotMachine({
				thinkingActor: hangingActor,
				actors: {
					serviceEntitiesTracking: noopActor,
					serviceApproaching: noopActor,
					serviceMeleeAttack: noopActor,
					serviceRangedSkirmish: noopActor,
					serviceFleeing: noopActor
				}
			}),
			{
				input: { bot }
			}
		)

		bot.hsm = {
			getContext: () => actor.getSnapshot().context
		}

		actor.start()

		try {
			actor.send({
				type: 'UPDATE_HEALTH',
				health: 8
			})
			await waitForTurn()
			await delay(50)

			assert.equal(
				actor
					.getSnapshot()
					.matches({ MAIN_ACTIVITY: { URGENT_NEEDS: 'EMERGENCY_HEALING' } } as never),
				true
			)
			assert.equal(eatingCalls, 0)
		} finally {
			actor.stop()
		}
	}
)

test('thinking execution enters a concrete executing substate without crashing', async () => {
	const thinkingActor = fromPromise(async () => ({
		kind: 'execute' as const,
		execution: {
			toolName: 'navigate_to' as const,
			args: {
				position: { x: 10, y: 64, z: 10 },
				range: 2
			}
		},
		subGoal: 'Move to target',
		transcript: ['navigate_to']
	}))

	const { actor } = (() => {
		const bot = new FakeBot() as any
		const machineActor = createActor(
			createBotMachine({
				thinkingActor,
				actors: {
					serviceEntitiesTracking: noopActor,
					serviceApproaching: noopActor,
					serviceMeleeAttack: noopActor,
					serviceRangedSkirmish: noopActor,
					serviceFleeing: noopActor,
					serviceEmergencyEating: hangingActor,
					serviceEmergencyHealing: hangingActor
				}
			}),
			{
				input: { bot }
			}
		)

		bot.hsm = {
			getContext: () => machineActor.getSnapshot().context
		}

		machineActor.start()
		return { actor: machineActor }
	})()

	try {
		actor.send({
			type: 'USER_COMMAND',
			username: 'Steve',
			text: 'Come to me'
		})
		await waitForTurn()
		await waitForTurn()

		assert.equal(
			(actor.getSnapshot() as any).matches({
				MAIN_ACTIVITY: { TASKS: { EXECUTING: 'NAVIGATING' } }
			}),
			true
		)
	} finally {
		actor.stop()
	}
})

test('mine_resource execution routes into MINING search state', async () => {
	const thinkingActor = fromPromise(async () => ({
		kind: 'execute' as const,
		execution: {
			toolName: 'mine_resource' as any,
			args: {
				block_name: ' IRON_ORE ',
				count: 2
			}
		},
		subGoal: 'Mine iron ore',
		transcript: ['mine_resource']
	}))

	const bot = new FakeBot() as any
	bot.registry = {
		...bot.registry,
		blocksByName: {
			iron_ore: { id: 15, name: 'iron_ore' }
		}
	}

	const actor = createActor(
		createBotMachine({
			thinkingActor,
			actors: {
				serviceEntitiesTracking: noopActor,
				serviceApproaching: noopActor,
				serviceMeleeAttack: noopActor,
				serviceRangedSkirmish: noopActor,
				serviceFleeing: noopActor,
				serviceEmergencyEating: hangingActor,
				serviceEmergencyHealing: hangingActor
			}
		}),
		{
			input: { bot }
		}
	)

	bot.hsm = {
		getContext: () => actor.getSnapshot().context
	}

	actor.start()

	try {
		actor.send({
			type: 'USER_COMMAND',
			username: 'Steve',
			text: 'Mine 2 iron ore'
		})
		await waitForTurn()
		await waitForTurn()

		assert.equal(
			(actor.getSnapshot() as any).matches({
				MAIN_ACTIVITY: {
					TASKS: { EXECUTING: { MINING: 'SEARCHING' } }
				}
			}),
			true
		)
		assert.equal(
			(actor.getSnapshot().context.taskData as any).blockName,
			'iron_ore'
		)
		assert.equal((actor.getSnapshot().context.taskData as any).count, 2)
	} finally {
		actor.stop()
	}
})

test('mine_resource records failure after repeated navigation failures', async () => {
	let thinkingCalls = 0
	const thinkingActor = fromPromise(async () => {
		thinkingCalls += 1
		if (thinkingCalls > 1) {
			return await new Promise<never>(() => {})
		}

		return {
			kind: 'execute' as const,
			execution: {
				toolName: 'mine_resource' as any,
				args: {
					block_name: 'iron_ore',
					count: 1
				}
			},
			subGoal: 'Mine iron ore',
			transcript: ['mine_resource']
		}
	})

	const bot = new FakeBot() as any
	const orePosition = createVec3(10, 64, 0)
	bot.registry = {
		...bot.registry,
		blocksByName: {
			iron_ore: { id: 15, name: 'iron_ore' }
		}
	}
	bot.findBlocks = () => [orePosition]
	bot.blockAt = (position: { x: number; y: number; z: number }) => {
		if (position.x === 10 && position.y === 64 && position.z === 0) {
			return {
				name: 'iron_ore',
				position: orePosition,
				drops: [1]
			}
		}
		if (position.x === 10 && position.y === 63 && position.z === 0) {
			return {
				name: 'stone',
				position: createVec3(10, 63, 0)
			}
		}
		return null
	}
	bot.pathfinder = {
		setGoal: (goal: unknown) => {
			if (goal) {
				setImmediate(() => bot.emit('path_stop', 'failed'))
			}
		}
	}

	const actor = createActor(
		createBotMachine({
			thinkingActor,
			actors: {
				serviceEntitiesTracking: noopActor,
				serviceApproaching: noopActor,
				serviceMeleeAttack: noopActor,
				serviceRangedSkirmish: noopActor,
				serviceFleeing: noopActor,
				serviceEmergencyEating: hangingActor,
				serviceEmergencyHealing: hangingActor
			}
		}),
		{
			input: { bot }
		}
	)

	bot.hsm = {
		getContext: () => actor.getSnapshot().context
	}

	actor.start()

	try {
		actor.send({
			type: 'USER_COMMAND',
			username: 'Steve',
			text: 'Mine 1 iron ore'
		})

		await waitUntil(() => actor.getSnapshot().context.lastResult === 'FAILED')

		assert.equal(actor.getSnapshot().context.lastAction, 'mine_resource')
		assert.equal(actor.getSnapshot().context.lastResult, 'FAILED')
		assert.equal(actor.getSnapshot().context.pendingExecution, null)
		assert.equal(actor.getSnapshot().context.taskData, null)
	} finally {
		actor.stop()
	}
})

test('mine_resource records failure after repeated breaking failures', async () => {
	let thinkingCalls = 0
	const thinkingActor = fromPromise(async () => {
		thinkingCalls += 1
		if (thinkingCalls > 1) {
			return await new Promise<never>(() => {})
		}

		return {
			kind: 'execute' as const,
			execution: {
				toolName: 'mine_resource' as any,
				args: {
					block_name: 'iron_ore',
					count: 1
				}
			},
			subGoal: 'Mine iron ore',
			transcript: ['mine_resource']
		}
	})

	const bot = new FakeBot() as any
	const orePosition = createVec3(1, 64, 0)
	bot.registry = {
		...bot.registry,
		blocksByName: {
			iron_ore: { id: 15, name: 'iron_ore' }
		}
	}
	bot.findBlocks = () => [orePosition]
	bot.blockAt = (position: { x: number; y: number; z: number }) => {
		if (position.x === 1 && position.y === 64 && position.z === 0) {
			return {
				name: 'iron_ore',
				position: orePosition,
				drops: [1]
			}
		}
		if (position.x === 1 && position.y === 63 && position.z === 0) {
			return {
				name: 'stone',
				position: createVec3(1, 63, 0)
			}
		}
		return null
	}
	bot.tool = {
		equipForBlock: async () => {
			throw new Error('no harvest tool')
		}
	}

	const actor = createActor(
		createBotMachine({
			thinkingActor,
			actors: {
				serviceEntitiesTracking: noopActor,
				serviceApproaching: noopActor,
				serviceMeleeAttack: noopActor,
				serviceRangedSkirmish: noopActor,
				serviceFleeing: noopActor,
				serviceEmergencyEating: hangingActor,
				serviceEmergencyHealing: hangingActor
			}
		}),
		{
			input: { bot }
		}
	)

	bot.hsm = {
		getContext: () => actor.getSnapshot().context
	}

	actor.start()

	try {
		actor.send({
			type: 'USER_COMMAND',
			username: 'Steve',
			text: 'Mine 1 iron ore'
		})

		await waitUntil(() => actor.getSnapshot().context.lastResult === 'FAILED')

		assert.equal(actor.getSnapshot().context.lastAction, 'mine_resource')
		assert.equal(actor.getSnapshot().context.lastResult, 'FAILED')
		assert.equal(actor.getSnapshot().context.pendingExecution, null)
		assert.equal(actor.getSnapshot().context.taskData, null)
	} finally {
		actor.stop()
	}
})

test('follow_entity runtime selector requires entity_name and entity_type to match the same entity', async () => {
	const thinkingActor = fromPromise(async () => ({
		kind: 'execute' as const,
		execution: {
			toolName: 'follow_entity' as const,
			args: {
				entity_name: 'Steve',
				entity_type: 'player',
				distance: 2,
				max_distance: 32
			}
		},
		subGoal: 'Follow Steve',
		transcript: ['follow_entity']
	}))

	const bot = new FakeBot() as any
	const selectedEntityIds: number[] = []
	const candidateEntities = [
		{
			id: 1,
			username: 'Steve',
			name: 'steve_skin',
			type: 'cow',
			position: createVec3(2, 64, 0),
			height: 1.8
		},
		{
			id: 2,
			username: 'Alex',
			name: 'alex',
			type: 'player',
			position: createVec3(3, 64, 0),
			height: 1.8
		},
		{
			id: 3,
			username: 'Steve',
			name: 'Steve',
			type: 'player',
			position: createVec3(4, 64, 0),
			height: 1.8
		}
	]

	bot.entities = Object.fromEntries(
		candidateEntities.map(entity => [String(entity.id), entity])
	)
	bot.nearestEntity = (predicate: (entity: any) => boolean) => {
		const target = candidateEntities.find(entity => predicate(entity)) ?? null
		selectedEntityIds.push(target?.id ?? -1)
		return target
	}

	const actor = createActor(
		createBotMachine({
			thinkingActor,
			actors: {
				serviceEntitiesTracking: noopActor,
				serviceApproaching: noopActor,
				serviceMeleeAttack: noopActor,
				serviceRangedSkirmish: noopActor,
				serviceFleeing: noopActor,
				serviceEmergencyEating: hangingActor,
				serviceEmergencyHealing: hangingActor
			}
		}),
		{
			input: { bot }
		}
	)

	bot.hsm = {
		getContext: () => actor.getSnapshot().context
	}

	actor.start()

	try {
		actor.send({
			type: 'USER_COMMAND',
			username: 'Steve',
			text: 'Follow Steve'
		})
		await waitForTurn()
		await waitForTurn()

		assert.equal(selectedEntityIds.length > 0, true)
		assert.equal(selectedEntityIds[0], 3)
		assert.equal(
			(actor.getSnapshot() as any).matches({
				MAIN_ACTIVITY: { TASKS: { EXECUTING: 'FOLLOWING' } }
			}),
			true
		)
	} finally {
		actor.stop()
	}
})

test('open_window, transfer_item, and close_window route through the HSM with session lifecycle', async () => {
	let thinkingCalls = 0
	let openCalls = 0
	let transferCalls = 0
	let closeCalls = 0
	let transferredArgs: any = null

	const thinkingActor = fromPromise(async () => {
		thinkingCalls += 1

		if (thinkingCalls === 1) {
			return {
				kind: 'execute' as const,
				execution: {
					toolName: 'open_window' as const,
					args: {
						position: { x: 1, y: 64, z: 1 }
					}
				},
				subGoal: 'Open the window',
				transcript: ['open_window']
			}
		}

		if (thinkingCalls === 2) {
			return {
				kind: 'execute' as const,
				execution: {
					toolName: 'transfer_item' as const,
					args: {
						source_zone: 'player_inventory',
						dest_zone: 'input',
						item_name: 'iron_ore',
						count: 1
					}
				},
				subGoal: 'Move the ore',
				transcript: ['transfer_item']
			}
		}

		if (thinkingCalls === 3) {
			return {
				kind: 'execute' as const,
				execution: {
					toolName: 'close_window' as const,
					args: {}
				},
				subGoal: 'Close the window',
				transcript: ['close_window']
			}
		}

		return await new Promise<never>(() => {})
	})

	const bot = new FakeBot() as any
	bot.blockAt = (position: { x: number; y: number; z: number }) =>
		position.x === 1 && position.y === 64 && position.z === 1
			? {
					name: 'furnace',
					position: createVec3(1, 64, 1)
				}
			: null
	bot.openFurnace = async () => {
		openCalls += 1
		return {
			slots: Array.from({ length: 46 }, (_, index) =>
				index === 10
					? {
							name: 'iron_ore',
							count: 3,
							type: 1,
							metadata: 0
						}
					: null
			),
			close: () => {
				closeCalls += 1
			},
			containerItems() {
				return []
			},
			findItemRangeName(start: number, end: number, itemName: string) {
				for (let index = start; index < end; index += 1) {
					const slot = this.slots[index]
					if (slot?.name === itemName) {
						return {
							type: slot.type ?? 1,
							metadata: slot.metadata ?? null
						}
					}
				}

				return null
			}
		}
	}
	bot.transfer = async (params: unknown) => {
		transferCalls += 1
		transferredArgs = params
	}

	const actor = createActor(
		createBotMachine({
			thinkingActor,
			actors: {
				serviceEntitiesTracking: noopActor,
				serviceApproaching: noopActor,
				serviceMeleeAttack: noopActor,
				serviceRangedSkirmish: noopActor,
				serviceFleeing: noopActor,
				serviceEmergencyEating: hangingActor,
				serviceEmergencyHealing: hangingActor
			}
		}),
		{
			input: { bot }
		}
	)

	bot.hsm = {
		getContext: () => actor.getSnapshot().context
	}

	actor.start()

	try {
		actor.send({
			type: 'USER_COMMAND',
			username: 'Steve',
			text: 'Organize the furnace'
		})

		await waitForTurn()
		await waitForTurn()
		await waitForTurn()
		await waitForTurn()
		await waitForTurn()
		await waitForTurn()

		assert.equal(openCalls, 1)
		assert.equal(transferCalls, 1)
		assert.equal(closeCalls, 1)
		assert.equal((actor.getSnapshot().context as any).activeWindowSession, null)
		assert.equal((transferredArgs as any)?.itemType, 1)
		assert.equal((transferredArgs as any)?.sourceStart, 3)
		assert.equal((transferredArgs as any)?.destStart, 0)
		assert.equal((transferredArgs as any)?.count, 1)
		assert.equal((transferredArgs as any)?.sourceEnd, 37)
		assert.equal((transferredArgs as any)?.destEnd, 1)
		assert.equal(
			(actor.getSnapshot() as any).matches({
				MAIN_ACTIVITY: { TASKS: 'THINKING' }
			}),
			true
		)
	} finally {
		actor.stop()
	}
})

test('START_COMBAT closes an active window before entering combat', async () => {
	let openCalls = 0
	let closeCalls = 0

	const thinkingActor = fromPromise(async () => {
		return {
			kind: 'execute' as const,
			execution: {
				toolName: 'open_window' as const,
				args: {
					position: { x: 1, y: 64, z: 1 }
				}
			},
			subGoal: 'Open the window',
			transcript: ['open_window']
		}
	})

	const bot = new FakeBot() as any
	bot.blockAt = (position: { x: number; y: number; z: number }) =>
		position.x === 1 && position.y === 64 && position.z === 1
			? {
					name: 'furnace',
					position: createVec3(1, 64, 1)
				}
			: null
	bot.openFurnace = async () => {
		openCalls += 1
		return {
			slots: Array.from({ length: 46 }, () => null),
			close: () => {
				closeCalls += 1
			},
			containerItems() {
				return []
			},
			findItemRangeName() {
				return null
			}
		}
	}

	const actor = createActor(
		createBotMachine({
			thinkingActor,
			actors: {
				serviceEntitiesTracking: noopActor,
				serviceApproaching: noopActor,
				serviceMeleeAttack: noopActor,
				serviceRangedSkirmish: noopActor,
				serviceFleeing: noopActor,
				serviceEmergencyEating: hangingActor,
				serviceEmergencyHealing: hangingActor
			}
		}),
		{
			input: { bot }
		}
	)

	bot.hsm = {
		getContext: () => actor.getSnapshot().context
	}

	actor.start()

	try {
		actor.send({
			type: 'USER_COMMAND',
			username: 'Steve',
			text: 'Open the window'
		})

		await waitForTurn()
		await waitForTurn()

		actor.send({ type: 'START_COMBAT', target: enemy as any })
		await waitForTurn()
		await waitForTurn()

		assert.equal(openCalls, 1)
		assert.equal(closeCalls, 1)
		assert.equal((actor.getSnapshot().context as any).activeWindowSession, null)
		assert.equal(
			(actor.getSnapshot().context as any).preferredCombatTargetId,
			enemy.id
		)
	} finally {
		actor.stop()
	}
})

test('UPDATE_ENTITIES closes an active window before auto-combat preemption', async () => {
	let openCalls = 0
	let closeCalls = 0

	const thinkingActor = fromPromise(async () => {
		return {
			kind: 'execute' as const,
			execution: {
				toolName: 'open_window' as const,
				args: {
					position: { x: 1, y: 64, z: 1 }
				}
			},
			subGoal: 'Open the window',
			transcript: ['open_window']
		}
	})

	const bot = new FakeBot() as any
	bot.blockAt = (position: { x: number; y: number; z: number }) =>
		position.x === 1 && position.y === 64 && position.z === 1
			? {
					name: 'furnace',
					position: createVec3(1, 64, 1)
				}
			: null
	bot.openFurnace = async () => {
		openCalls += 1
		return {
			slots: Array.from({ length: 46 }, () => null),
			close: () => {
				closeCalls += 1
			},
			containerItems() {
				return []
			},
			findItemRangeName() {
				return null
			}
		}
	}

	const actor = createActor(
		createBotMachine({
			thinkingActor,
			actors: {
				serviceEntitiesTracking: noopActor,
				serviceApproaching: noopActor,
				serviceMeleeAttack: noopActor,
				serviceRangedSkirmish: noopActor,
				serviceFleeing: noopActor,
				serviceEmergencyEating: hangingActor,
				serviceEmergencyHealing: hangingActor
			}
		}),
		{
			input: { bot }
		}
	)

	bot.hsm = {
		getContext: () => actor.getSnapshot().context
	}

	actor.start()

	try {
		actor.send({
			type: 'USER_COMMAND',
			username: 'Steve',
			text: 'Open the window'
		})

		await waitForTurn()
		await waitForTurn()

		actor.send({
			type: 'UPDATE_ENTITIES',
			entities: [enemy as any],
			enemies: [enemy as any],
			players: [],
			nearestEnemy: { entity: enemy as any, distance: 2 }
		})
		await waitForTurn()
		await waitForTurn()

		assert.equal(openCalls, 1)
		assert.equal(closeCalls, 1)
		assert.equal((actor.getSnapshot().context as any).activeWindowSession, null)
		assert.equal(
			(actor.getSnapshot().context as any).preferredCombatTargetId,
			null
		)
	} finally {
		actor.stop()
	}
})

test('START_URGENT_NEEDS closes an active window before urgent handling', async () => {
	let openCalls = 0
	let closeCalls = 0

	const thinkingActor = fromPromise(async () => {
		return {
			kind: 'execute' as const,
			execution: {
				toolName: 'open_window' as const,
				args: {
					position: { x: 1, y: 64, z: 1 }
				}
			},
			subGoal: 'Open the window',
			transcript: ['open_window']
		}
	})

	const bot = new FakeBot() as any
	bot.blockAt = (position: { x: number; y: number; z: number }) =>
		position.x === 1 && position.y === 64 && position.z === 1
			? {
					name: 'furnace',
					position: createVec3(1, 64, 1)
				}
			: null
	bot.openFurnace = async () => {
		openCalls += 1
		return {
			slots: Array.from({ length: 46 }, () => null),
			close: () => {
				closeCalls += 1
			},
			containerItems() {
				return []
			},
			findItemRangeName() {
				return null
			}
		}
	}

	const actor = createActor(
		createBotMachine({
			thinkingActor,
			actors: {
				serviceEntitiesTracking: noopActor,
				serviceApproaching: noopActor,
				serviceMeleeAttack: noopActor,
				serviceRangedSkirmish: noopActor,
				serviceFleeing: noopActor,
				serviceEmergencyEating: hangingActor,
				serviceEmergencyHealing: hangingActor
			}
		}),
		{
			input: { bot }
		}
	)

	bot.hsm = {
		getContext: () => actor.getSnapshot().context
	}

	actor.start()

	try {
		actor.send({
			type: 'USER_COMMAND',
			username: 'Steve',
			text: 'Open the window'
		})

		await waitForTurn()
		await waitForTurn()

		actor.send({ type: 'START_URGENT_NEEDS', need: 'food' })
		await waitForTurn()
		await waitForTurn()

		assert.equal(openCalls, 1)
		assert.equal(closeCalls, 1)
		assert.equal((actor.getSnapshot().context as any).activeWindowSession, null)
		assert.equal(
			(actor.getSnapshot() as any).matches({
				MAIN_ACTIVITY: { URGENT_NEEDS: 'EMERGENCY_EATING' }
			}),
			true
		)
	} finally {
		actor.stop()
	}
})

test('failed window close marks the session retryable until a confirmed close succeeds', async () => {
	let thinkingCalls = 0
	let openCalls = 0
	let closeCalls = 0
	let releaseRetry: () => void = () => {}
	const retryGate = new Promise<void>(resolve => {
		releaseRetry = resolve
	})

	const thinkingActor = fromPromise(async () => {
		thinkingCalls += 1

		if (thinkingCalls === 1) {
			return {
				kind: 'execute' as const,
				execution: {
					toolName: 'open_window' as const,
					args: {
						position: { x: 1, y: 64, z: 1 }
					}
				},
				subGoal: 'Open the window',
				transcript: ['open_window']
			}
		}

		if (thinkingCalls === 2) {
			return {
				kind: 'execute' as const,
				execution: {
					toolName: 'close_window' as const,
					args: {}
				},
				subGoal: 'Close the window',
				transcript: ['close_window']
			}
		}

		if (thinkingCalls === 3) {
			await retryGate
			return {
				kind: 'execute' as const,
				execution: {
					toolName: 'close_window' as const,
					args: {}
				},
				subGoal: 'Retry the close',
				transcript: ['close_window']
			}
		}

		if (thinkingCalls === 4) {
			return {
				kind: 'execute' as const,
				execution: {
					toolName: 'open_window' as const,
					args: {
						position: { x: 1, y: 64, z: 1 }
					}
				},
				subGoal: 'Reopen the window',
				transcript: ['open_window']
			}
		}

		return await new Promise<never>(() => {})
	})

	const bot = new FakeBot() as any
	bot.blockAt = (position: { x: number; y: number; z: number }) =>
		position.x === 1 && position.y === 64 && position.z === 1
			? {
					name: 'furnace',
					position: createVec3(1, 64, 1)
				}
			: null
	bot.openFurnace = async () => {
		openCalls += 1
		return {
			slots: Array.from({ length: 46 }, () => null),
			close: () => {
				closeCalls += 1
				if (closeCalls === 1) {
					throw new Error('close failed')
				}
			},
			containerItems() {
				return []
			},
			findItemRangeName() {
				return null
			}
		}
	}

	const actor = createActor(
		createBotMachine({
			thinkingActor,
			actors: {
				serviceEntitiesTracking: noopActor,
				serviceApproaching: noopActor,
				serviceMeleeAttack: noopActor,
				serviceRangedSkirmish: noopActor,
				serviceFleeing: noopActor,
				serviceEmergencyEating: hangingActor,
				serviceEmergencyHealing: hangingActor
			}
		}),
		{
			input: { bot }
		}
	)

	bot.hsm = {
		getContext: () => actor.getSnapshot().context
	}

	actor.start()

	try {
		actor.send({
			type: 'USER_COMMAND',
			username: 'Steve',
			text: 'Retry the window'
		})

		for (let i = 0; i < 6; i += 1) {
			await waitForTurn()
			if (closeCalls === 1 && thinkingCalls >= 3) {
				break
			}
		}

		assert.equal(openCalls, 1)
		assert.equal(closeCalls, 1)
		assert.equal(
			(actor.getSnapshot().context as any).activeWindowSessionState,
			'close_failed'
		)
		assert.equal(
			(actor.getSnapshot().context as any).activeWindowSession !== null,
			true
		)

		releaseRetry()
		await waitForTurn()
		await waitForTurn()
		await waitForTurn()
		await waitForTurn()

		assert.equal(openCalls, 2)
		assert.equal(closeCalls, 2)
		assert.equal(
			(actor.getSnapshot().context as any).activeWindowSessionState,
			'open'
		)
		assert.equal(
			(actor.getSnapshot().context as any).activeWindowSession !== null,
			true
		)
	} finally {
		actor.stop()
	}
})

test('transfer_item is rejected while the window close is unconfirmed', async () => {
	let thinkingCalls = 0
	let openCalls = 0
	let closeCalls = 0
	let transferCalls = 0

	const thinkingActor = fromPromise(async () => {
		thinkingCalls += 1

		if (thinkingCalls === 1) {
			return {
				kind: 'execute' as const,
				execution: {
					toolName: 'open_window' as const,
					args: {
						position: { x: 1, y: 64, z: 1 }
					}
				},
				subGoal: 'Open the window',
				transcript: ['open_window']
			}
		}

		if (thinkingCalls === 2) {
			return {
				kind: 'execute' as const,
				execution: {
					toolName: 'close_window' as const,
					args: {}
				},
				subGoal: 'Close the window',
				transcript: ['close_window']
			}
		}

		if (thinkingCalls === 3) {
			return {
				kind: 'execute' as const,
				execution: {
					toolName: 'transfer_item' as const,
					args: {
						source_zone: 'player_inventory',
						dest_zone: 'input',
						item_name: 'iron_ore',
						count: 1
					}
				},
				subGoal: 'Try to move ore',
				transcript: ['transfer_item']
			}
		}

		return await new Promise<never>(() => {})
	})

	const bot = new FakeBot() as any
	bot.blockAt = (position: { x: number; y: number; z: number }) =>
		position.x === 1 && position.y === 64 && position.z === 1
			? {
					name: 'furnace',
					position: createVec3(1, 64, 1)
				}
			: null
	bot.openFurnace = async () => {
		openCalls += 1
		return {
			slots: Array.from({ length: 46 }, () => null),
			close: () => {
				closeCalls += 1
				if (closeCalls === 1) {
					throw new Error('close failed')
				}
			},
			containerItems() {
				return []
			},
			findItemRangeName() {
				return null
			}
		}
	}
	bot.transfer = async () => {
		transferCalls += 1
	}

	const actor = createActor(
		createBotMachine({
			thinkingActor,
			actors: {
				serviceEntitiesTracking: noopActor,
				serviceApproaching: noopActor,
				serviceMeleeAttack: noopActor,
				serviceRangedSkirmish: noopActor,
				serviceFleeing: noopActor,
				serviceEmergencyEating: hangingActor,
				serviceEmergencyHealing: hangingActor
			}
		}),
		{
			input: { bot }
		}
	)

	bot.hsm = {
		getContext: () => actor.getSnapshot().context
	}

	actor.start()

	try {
		actor.send({
			type: 'USER_COMMAND',
			username: 'Steve',
			text: 'Retry the window'
		})

		for (let i = 0; i < 8; i += 1) {
			await waitForTurn()
			if (thinkingCalls >= 3) {
				break
			}
		}

		assert.equal(openCalls, 1)
		assert.equal(closeCalls, 1)
		assert.equal(transferCalls, 0)
		assert.equal(
			(actor.getSnapshot().context as any).activeWindowSessionState,
			'close_failed'
		)
	} finally {
		actor.stop()
	}
})

test('open_window abort after open preserves the session when close fails', async () => {
	let thinkingCalls = 0
	let openCalls = 0
	let closeCalls = 0

	const thinkingActor = fromPromise(async () => {
		thinkingCalls += 1
		if (thinkingCalls === 1) {
			return {
				kind: 'execute' as const,
				execution: {
					toolName: 'open_window' as const,
					args: {
						position: { x: 1, y: 64, z: 1 }
					}
				},
				subGoal: 'Open the window',
				transcript: ['open_window']
			}
		}

		return await new Promise<never>(() => {})
	})

	const bot = new FakeBot() as any
	bot.blockAt = (position: { x: number; y: number; z: number }) =>
		position.x === 1 && position.y === 64 && position.z === 1
			? {
					name: 'furnace',
					position: createVec3(1, 64, 1)
				}
			: null
	bot.openFurnace = async () => {
		openCalls += 1
		return await new Promise(resolve => {
			setImmediate(() => {
				process.nextTick(() => {
					actor.send({
						type: 'START_COMBAT',
						target: enemy as any
					})
				})
				resolve({
					slots: Array.from({ length: 46 }, () => null),
					close: () => {
						closeCalls += 1
						throw new Error('close failed')
					},
					containerItems() {
						return []
					},
					findItemRangeName() {
						return null
					}
				})
			})
		})
	}

	const actor = createActor(
		createBotMachine({
			thinkingActor,
			actors: {
				serviceEntitiesTracking: noopActor,
				serviceApproaching: noopActor,
				serviceMeleeAttack: noopActor,
				serviceRangedSkirmish: noopActor,
				serviceFleeing: noopActor,
				serviceEmergencyEating: hangingActor,
				serviceEmergencyHealing: hangingActor
			}
		}),
		{
			input: { bot }
		}
	)

	bot.hsm = {
		getContext: () => actor.getSnapshot().context,
		send: (event: any) => actor.send(event)
	}
	actor.start()

	try {
		actor.send({
			type: 'USER_COMMAND',
			username: 'Steve',
			text: 'Open the window'
		})

		await waitForTurn()
		await waitForTurn()
		await waitForTurn()

		assert.equal(openCalls, 1)
		assert.equal(closeCalls, 1)
		assert.equal(
			(actor.getSnapshot().context as any).activeWindowSession !== null,
			true
		)
		assert.equal(
			(actor.getSnapshot().context as any).activeWindowSessionState,
			'close_failed'
		)
		assert.equal((actor.getSnapshot().context as any).lastResult, 'FAILED')
	} finally {
		actor.stop()
	}
})

test('DEATH clears active window session state and closes any open window', async () => {
	let openCalls = 0
	let closeCalls = 0

	let thinkingCalls = 0
	const thinkingActor = fromPromise(async () => {
		thinkingCalls += 1
		if (thinkingCalls === 1) {
			return {
				kind: 'execute' as const,
				execution: {
					toolName: 'open_window' as const,
					args: {
						position: { x: 1, y: 64, z: 1 }
					}
				},
				subGoal: 'Open the window',
				transcript: ['open_window']
			}
		}

		return await new Promise<never>(() => {})
	})

	const bot = new FakeBot() as any
	bot.blockAt = (position: { x: number; y: number; z: number }) =>
		position.x === 1 && position.y === 64 && position.z === 1
			? {
					name: 'furnace',
					position: createVec3(1, 64, 1)
				}
			: null
	bot.openFurnace = async () => {
		openCalls += 1
		return {
			slots: Array.from({ length: 46 }, () => null),
			close: () => {
				closeCalls += 1
			},
			containerItems() {
				return []
			},
			findItemRangeName() {
				return null
			}
		}
	}

	const actor = createActor(
		createBotMachine({
			thinkingActor,
			actors: {
				serviceEntitiesTracking: noopActor,
				serviceApproaching: noopActor,
				serviceMeleeAttack: noopActor,
				serviceRangedSkirmish: noopActor,
				serviceFleeing: noopActor,
				serviceEmergencyEating: hangingActor,
				serviceEmergencyHealing: hangingActor
			}
		}),
		{
			input: { bot }
		}
	)

	bot.hsm = {
		getContext: () => actor.getSnapshot().context
	}

	actor.start()

	try {
		actor.send({
			type: 'USER_COMMAND',
			username: 'Steve',
			text: 'Open the window'
		})

		await waitForTurn()
		await waitForTurn()

		actor.send({ type: 'DEATH' })
		await waitForTurn()

		assert.equal(openCalls, 1)
		assert.equal(closeCalls, 1)
		assert.equal((actor.getSnapshot().context as any).activeWindowSession, null)
		assert.equal(
			(actor.getSnapshot().context as any).activeWindowSessionState,
			null
		)
	} finally {
		actor.stop()
	}
})

test('STOP_CURRENT_GOAL clears active window session state and closes any open window', async () => {
	let openCalls = 0
	let closeCalls = 0

	let thinkingCalls = 0
	const thinkingActor = fromPromise(async () => {
		thinkingCalls += 1
		if (thinkingCalls === 1) {
			return {
				kind: 'execute' as const,
				execution: {
					toolName: 'open_window' as const,
					args: {
						position: { x: 1, y: 64, z: 1 }
					}
				},
				subGoal: 'Open the window',
				transcript: ['open_window']
			}
		}

		return await new Promise<never>(() => {})
	})

	const bot = new FakeBot() as any
	bot.blockAt = (position: { x: number; y: number; z: number }) =>
		position.x === 1 && position.y === 64 && position.z === 1
			? {
					name: 'furnace',
					position: createVec3(1, 64, 1)
				}
			: null
	bot.openFurnace = async () => {
		openCalls += 1
		return {
			slots: Array.from({ length: 46 }, () => null),
			close: () => {
				closeCalls += 1
			},
			containerItems() {
				return []
			},
			findItemRangeName() {
				return null
			}
		}
	}

	const actor = createActor(
		createBotMachine({
			thinkingActor,
			actors: {
				serviceEntitiesTracking: noopActor,
				serviceApproaching: noopActor,
				serviceMeleeAttack: noopActor,
				serviceRangedSkirmish: noopActor,
				serviceFleeing: noopActor,
				serviceEmergencyEating: hangingActor,
				serviceEmergencyHealing: hangingActor
			}
		}),
		{
			input: { bot }
		}
	)

	bot.hsm = {
		getContext: () => actor.getSnapshot().context
	}

	actor.start()

	try {
		actor.send({
			type: 'USER_COMMAND',
			username: 'Steve',
			text: 'Open the window'
		})

		await waitForTurn()
		await waitForTurn()

		actor.send({ type: 'STOP_CURRENT_GOAL' })
		await waitForTurn()

		assert.equal(openCalls, 1)
		assert.equal(closeCalls, 1)
		assert.equal((actor.getSnapshot().context as any).activeWindowSession, null)
		assert.equal(
			(actor.getSnapshot().context as any).activeWindowSessionState,
			null
		)
		assert.equal(
			actor.getSnapshot().matches({ MAIN_ACTIVITY: 'IDLE' } as never),
			true
		)
	} finally {
		actor.stop()
	}
})

test('thinking finish clears active window session state and closes any open window', async () => {
	let thinkingCalls = 0
	let openCalls = 0
	let closeCalls = 0

	const thinkingActor = fromPromise(async () => {
		thinkingCalls += 1
		if (thinkingCalls === 1) {
			return {
				kind: 'execute' as const,
				execution: {
					toolName: 'open_window' as const,
					args: {
						position: { x: 1, y: 64, z: 1 }
					}
				},
				subGoal: 'Open the window',
				transcript: ['open_window']
			}
		}

		if (thinkingCalls === 2) {
			return {
				kind: 'finish' as const,
				message: 'Finished',
				transcript: ['finish_goal']
			}
		}

		return await new Promise<never>(() => {})
	})

	const bot = new FakeBot() as any
	bot.blockAt = (position: { x: number; y: number; z: number }) =>
		position.x === 1 && position.y === 64 && position.z === 1
			? {
					name: 'furnace',
					position: createVec3(1, 64, 1)
				}
			: null
	bot.openFurnace = async () => {
		openCalls += 1
		return {
			slots: Array.from({ length: 46 }, () => null),
			close: () => {
				closeCalls += 1
			},
			containerItems() {
				return []
			},
			findItemRangeName() {
				return null
			}
		}
	}

	const actor = createActor(
		createBotMachine({
			thinkingActor,
			actors: {
				serviceEntitiesTracking: noopActor,
				serviceApproaching: noopActor,
				serviceMeleeAttack: noopActor,
				serviceRangedSkirmish: noopActor,
				serviceFleeing: noopActor,
				serviceEmergencyEating: hangingActor,
				serviceEmergencyHealing: hangingActor
			}
		}),
		{
			input: { bot }
		}
	)

	bot.hsm = {
		getContext: () => actor.getSnapshot().context
	}

	actor.start()

	try {
		actor.send({
			type: 'USER_COMMAND',
			username: 'Steve',
			text: 'Open then finish'
		})

		await waitForTurn()
		await waitForTurn()
		await waitForTurn()
		await waitForTurn()

		assert.equal(openCalls, 1)
		assert.equal(closeCalls, 1)
		assert.equal((actor.getSnapshot().context as any).activeWindowSession, null)
		assert.equal(
			(actor.getSnapshot().context as any).activeWindowSessionState,
			null
		)
		assert.equal(
			actor.getSnapshot().matches({ MAIN_ACTIVITY: 'IDLE' } as never),
			true
		)
	} finally {
		actor.stop()
	}
})

test('thinking failure clears active window session state and closes any open window', async () => {
	let thinkingCalls = 0
	let openCalls = 0
	let closeCalls = 0

	const thinkingActor = fromPromise(async () => {
		thinkingCalls += 1
		if (thinkingCalls === 1) {
			return {
				kind: 'execute' as const,
				execution: {
					toolName: 'open_window' as const,
					args: {
						position: { x: 1, y: 64, z: 1 }
					}
				},
				subGoal: 'Open the window',
				transcript: ['open_window']
			}
		}

		if (thinkingCalls === 2) {
			return {
				kind: 'failed' as const,
				reason: 'Cannot proceed',
				transcript: ['failure']
			}
		}

		return await new Promise<never>(() => {})
	})

	const bot = new FakeBot() as any
	bot.blockAt = (position: { x: number; y: number; z: number }) =>
		position.x === 1 && position.y === 64 && position.z === 1
			? {
					name: 'furnace',
					position: createVec3(1, 64, 1)
				}
			: null
	bot.openFurnace = async () => {
		openCalls += 1
		return {
			slots: Array.from({ length: 46 }, () => null),
			close: () => {
				closeCalls += 1
			},
			containerItems() {
				return []
			},
			findItemRangeName() {
				return null
			}
		}
	}

	const actor = createActor(
		createBotMachine({
			thinkingActor,
			actors: {
				serviceEntitiesTracking: noopActor,
				serviceApproaching: noopActor,
				serviceMeleeAttack: noopActor,
				serviceRangedSkirmish: noopActor,
				serviceFleeing: noopActor,
				serviceEmergencyEating: hangingActor,
				serviceEmergencyHealing: hangingActor
			}
		}),
		{
			input: { bot }
		}
	)

	bot.hsm = {
		getContext: () => actor.getSnapshot().context
	}

	actor.start()

	try {
		actor.send({
			type: 'USER_COMMAND',
			username: 'Steve',
			text: 'Open then fail'
		})

		await waitForTurn()
		await waitForTurn()
		await waitForTurn()
		await waitForTurn()

		assert.equal(openCalls, 1)
		assert.equal(closeCalls, 1)
		assert.equal((actor.getSnapshot().context as any).activeWindowSession, null)
		assert.equal(
			(actor.getSnapshot().context as any).activeWindowSessionState,
			null
		)
		assert.equal(
			actor.getSnapshot().matches({ MAIN_ACTIVITY: 'IDLE' } as never),
			true
		)
	} finally {
		actor.stop()
	}
})

test('invalid navigate args do not default to world zero', async () => {
	let thinkingCalls = 0
	const setGoalCalls: unknown[] = []
	const thinkingActor = fromPromise(async () => {
		thinkingCalls += 1
		if (thinkingCalls === 1) {
			return {
				kind: 'execute' as const,
				execution: {
					toolName: 'navigate_to' as const,
					args: {}
				},
				subGoal: 'Move to target',
				transcript: ['navigate_to']
			}
		}

		return await new Promise<never>(() => {})
	})

	const bot = new FakeBot() as any
	bot.pathfinder = {
		setGoal: (goal: unknown) => {
			setGoalCalls.push(goal)
		}
	}

	const actor = createActor(
		createBotMachine({
			thinkingActor,
			actors: {
				serviceEntitiesTracking: noopActor,
				serviceApproaching: noopActor,
				serviceMeleeAttack: noopActor,
				serviceRangedSkirmish: noopActor,
				serviceFleeing: noopActor,
				serviceEmergencyEating: hangingActor,
				serviceEmergencyHealing: hangingActor
			}
		}),
		{
			input: { bot }
		}
	)

	bot.hsm = {
		getContext: () => actor.getSnapshot().context
	}

	actor.start()

	try {
		actor.send({
			type: 'USER_COMMAND',
			username: 'Steve',
			text: 'Come to me'
		})
		await waitForTurn()
		await waitForTurn()
		await waitForTurn()

		const nonNullGoalCalls = setGoalCalls.filter(Boolean)
		assert.equal(nonNullGoalCalls.length, 0)
		assert.equal(
			(actor.getSnapshot() as any).matches({
				MAIN_ACTIVITY: { TASKS: 'THINKING' }
			}),
			true
		)
	} finally {
		actor.stop()
	}
})

test('conversation history survives completed goals and is appended on user and assistant turns', async () => {
	let thinkingCalls = 0
	const thinkingActor = fromPromise(async () => {
		thinkingCalls += 1

		if (thinkingCalls === 1) {
			return {
				kind: 'finish' as const,
				message: 'Я буду отвечать по-русски.',
				transcript: ['finish_goal']
			}
		}

		return await new Promise<never>(() => {})
	})

	const bot = new FakeBot() as any
	const actor = createActor(
		createBotMachine({
			thinkingActor,
			actors: {
				serviceEntitiesTracking: noopActor,
				serviceApproaching: noopActor,
				serviceMeleeAttack: noopActor,
				serviceRangedSkirmish: noopActor,
				serviceFleeing: noopActor,
				serviceEmergencyEating: hangingActor,
				serviceEmergencyHealing: hangingActor
			}
		}),
		{
			input: { bot }
		}
	)

	bot.hsm = {
		getContext: () => actor.getSnapshot().context
	}

	actor.start()

	try {
		actor.send({
			type: 'USER_COMMAND',
			username: 'Smidvard',
			text: 'отвечай по-русски'
		})

		await waitForTurn()
		await waitForTurn()

		assert.deepEqual(actor.getSnapshot().context.conversationHistory, [
			{
				role: 'user',
				username: 'Smidvard',
				message: 'отвечай по-русски'
			},
			{
				role: 'assistant',
				message: 'Я буду отвечать по-русски.'
			}
		])
		assert.equal(actor.getSnapshot().context.currentGoal, null)

		actor.send({
			type: 'USER_COMMAND',
			username: 'Smidvard',
			text: 'что у тебя в инвентаре?'
		})
		await waitForTurn()

		assert.deepEqual(actor.getSnapshot().context.conversationHistory, [
			{
				role: 'user',
				username: 'Smidvard',
				message: 'отвечай по-русски'
			},
			{
				role: 'assistant',
				message: 'Я буду отвечать по-русски.'
			},
			{
				role: 'user',
				username: 'Smidvard',
				message: 'что у тебя в инвентаре?'
			}
		])
	} finally {
		actor.stop()
	}
})
