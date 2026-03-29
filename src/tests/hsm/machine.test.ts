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
		setGoal: () => {}
	}
	movements = {
		allowSprinting: true
	}
	hawkEye = {
		stop: () => {},
		autoAttack: () => {}
	}
	tool = {
		equipForBlock: async () => {}
	}
	armorManager = {}
	pvp = {
		attack: () => {},
		stop: () => {}
	}
	utils = {
		getAllFood: () => [{ name: 'bread' }],
		eating: async () => {},
		stopEating: () => {},
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
			close() {},
			containerItems() {
				return []
			}
		}
	}
	async openContainer() {
		return {
			close() {},
			containerItems() {
				return []
			}
		}
	}
	async openFurnace() {
		return {
			close() {},
			containerItems() {
				return []
			}
		}
	}
	async openBlock() {
		return {
			close() {},
			containerItems() {
				return []
			}
		}
	}
	closeWindow() {}
	setControlState() {}
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

test('thinking execution enters a concrete executing substate without crashing', async () => {
	const thinkingActor = fromPromise(async () => ({
		kind: 'execute' as const,
		execution: {
			toolName: 'call_navigate' as const,
			args: {
				position: { x: 10, y: 64, z: 10 },
				range: 2
			}
		},
		subGoal: 'Move to target',
		transcript: ['call_navigate']
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

test('invalid navigate args do not default to world zero', async () => {
	let thinkingCalls = 0
	const setGoalCalls: unknown[] = []
	const thinkingActor = fromPromise(async () => {
		thinkingCalls += 1
		if (thinkingCalls === 1) {
			return {
				kind: 'execute' as const,
				execution: {
					toolName: 'call_navigate' as const,
					args: {}
				},
				subGoal: 'Move to target',
				transcript: ['call_navigate']
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
