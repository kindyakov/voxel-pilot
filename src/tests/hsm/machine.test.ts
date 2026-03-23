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
	}
})

class FakeBot extends EventEmitter {
	username = 'Bot'
	entity = { id: 999, position: createVec3(0, 64, 0) }
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
	movement = {}
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
				serviceMeleeAttack: noopActor,
				serviceRangedAttack: noopActor,
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
					serviceMeleeAttack: noopActor,
					serviceRangedAttack: noopActor,
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
				serviceMeleeAttack: noopActor,
				serviceRangedAttack: noopActor,
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
