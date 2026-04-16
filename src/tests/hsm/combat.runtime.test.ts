import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'

import { Vec3 } from 'vec3'
import { createActor, fromPromise } from 'xstate'

import { createBotMachine } from '../../hsm/machine.js'

const hangingActor = fromPromise(async () => {
	return await new Promise<never>(() => {})
})

const noopActor = fromPromise(async () => {})

const createEnemy = (distance: number) => ({
	id: 1,
	type: 'hostile',
	name: 'zombie',
	height: 1.8,
	position: new Vec3(distance, 64, 0),
	isValid: true
})

class CombatBot extends EventEmitter {
	username = 'Bot'
	entity = { id: 999, position: new Vec3(0, 64, 0), height: 1.8 }
	entities = {}
	health = 20
	food = 20
	foodSaturation = 5
	oxygenLevel = 20
	inventoryItems: Array<{ name: string }> = []
	pvpAttackCalls = 0
	pvpStopCalls = 0
	pvpForceStopCalls = 0
	hawkEyeStopCalls = 0
	hawkEyeAttackCalls = 0
	pathfinderSetGoalCalls: unknown[] = []
	movementSetGoalCalls: unknown[] = []
	movementSteerCalls: Array<{ yaw: number; force: boolean | undefined }> = []
	controlStates = new Map<string, boolean>()
	equipCalls: string[] = []
	logMessages: string[] = []
	eatingCalls = 0
	stopEatingCalls = 0
	searchedPlayer: any = null
	inventory = {
		slots: Array.from({ length: 46 }, () => null),
		items: () => this.inventoryItems
	}
	registry = {
		isNewerOrEqualTo: () => true
	}
	movement = {
		goals: {
			Default: { id: 'default-goal' }
		},
		heuristic: {
			get: (_label: string) => ({
				target: (_target: Vec3) => ({
					avoid: (_avoid: boolean) => {}
				}),
				avoid: (_avoid: boolean) => {}
			})
		},
		setGoal: (goal: unknown) => {
			this.movementSetGoalCalls.push(goal)
		},
		getYaw: () => 0.25,
		steer: async (yaw: number, force?: boolean) => {
			this.movementSteerCalls.push({ yaw, force })
		}
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
		setGoal: (goal: unknown) => {
			this.pathfinderSetGoalCalls.push(goal)
		}
	}
	movements = {
		allowSprinting: true,
		allowParkour: true
	}
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
		attack: () => {
			this.pvpAttackCalls += 1
		},
		stop: () => {
			this.pvpStopCalls += 1
		},
		forceStop: () => {
			this.pvpForceStopCalls += 1
		},
		movements: null as unknown
	}
	utils = {
		getAllFood: () => [{ name: 'bread' }],
		eating: async () => {
			this.eatingCalls += 1
		},
		stopEating: () => {
			this.stopEatingCalls += 1
		},
		getMeleeWeapon: () =>
			this.inventoryItems.find(item => item.name.includes('sword')) ?? null,
		getRangeWeapon: () =>
			this.inventoryItems.find(
				item => item.name.includes('bow') || item.name.includes('crossbow')
			) ?? null,
		getArrow: () =>
			this.inventoryItems.find(item => item.name.includes('arrow')) ?? null,
		searchPlayer: () => this.searchedPlayer,
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

	chat() {}
	quit() {}
	loadPlugin() {}
	async dig() {}
	async placeBlock() {}
	async equip(item: { name: string }) {
		this.equipCalls.push(item.name)
	}
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
	setControlState(control: string, state: boolean) {
		this.controlStates.set(control, state)
	}
}

class DelayedEquipCombatBot extends CombatBot {
	override async equip(item: { name: string }) {
		this.equipCalls.push(item.name)
		await delay(100)
		this.logMessages.push(`equip resolved ${item.name}`)
	}
}

class NoMovementCombatBot extends CombatBot {
	override movement = undefined as any
}

const createRuntimeActor = (bot: CombatBot) => {
	const actor = createActor(
		createBotMachine({
			thinkingActor: hangingActor,
			actors: {
				serviceEntitiesTracking: noopActor,
				serviceEmergencyEating: hangingActor,
				serviceEmergencyHealing: hangingActor
			}
		}),
		{
			input: { bot: bot as any }
		}
	)

	bot.hsm = {
		getContext: () => actor.getSnapshot().context
	}

	actor.start()
	return actor
}

const createSurvivalRuntimeActor = (bot: CombatBot) => {
	const actor = createActor(
		createBotMachine({
			thinkingActor: hangingActor,
			actors: {
				serviceEntitiesTracking: noopActor,
				serviceApproaching: noopActor,
				serviceMeleeAttack: noopActor,
				serviceRangedSkirmish: noopActor
			}
		}),
		{
			input: { bot: bot as any }
		}
	)

	bot.hsm = {
		getContext: () => actor.getSnapshot().context
	}

	actor.start()
	return actor
}

const enterCombat = async (
	actor: ReturnType<typeof createRuntimeActor>,
	enemy: ReturnType<typeof createEnemy>
) => {
	actor.send({
		type: 'UPDATE_ENTITIES',
		entities: [enemy as any],
		enemies: [enemy as any],
		players: [],
		nearestEnemy: {
			entity: enemy as any,
			distance: actor
				.getSnapshot()
				.context.bot!.entity.position.distanceTo(enemy.position)
		}
	})
	await delay(0)
	await delay(0)
}

test('STOP_COMBAT cleans up active melee combat', async () => {
	const bot = new CombatBot()
	bot.inventoryItems = [{ name: 'iron_sword' }]
	const actor = createRuntimeActor(bot)

	try {
		await enterCombat(actor, createEnemy(2))
		await delay(550)

		assert.equal(bot.pvpAttackCalls > 0, true)

		actor.send({ type: 'STOP_COMBAT' })
		await delay(0)
		await delay(0)

		assert.equal(bot.pvpStopCalls > 0, true)
	} finally {
		actor.stop()
	}
})

test('STOP_COMBAT cleans up active ranged combat', async () => {
	const bot = new CombatBot()
	bot.inventoryItems = [{ name: 'bow' }, { name: 'arrow' }]
	const actor = createRuntimeActor(bot)

	try {
		await enterCombat(actor, createEnemy(12))
		await delay(50)

		assert.deepEqual(bot.equipCalls, ['bow'])

		actor.send({ type: 'STOP_COMBAT' })
		await delay(0)
		await delay(0)

		assert.equal(bot.hawkEyeStopCalls > 0, true)
	} finally {
		actor.stop()
	}
})

test('ranged skirmish uses movement ownership without pathfinder goals', async () => {
	const bot = new CombatBot()
	bot.inventoryItems = [{ name: 'bow' }, { name: 'arrow' }]
	const actor = createRuntimeActor(bot)

	try {
		await enterCombat(actor, createEnemy(12))
		await delay(300)

		assert.equal(
			actor.getSnapshot().matches({
				MAIN_ACTIVITY: { COMBAT: 'RANGED_SKIRMISHING' }
			} as never),
			true
		)
		assert.equal(actor.getSnapshot().context.movementOwner, 'MOVEMENT')
		assert.equal(bot.movementSetGoalCalls.length > 0, true)
		assert.equal(bot.movementSteerCalls.length > 0, true)
		assert.deepEqual(
			bot.pathfinderSetGoalCalls.filter(goal => goal !== null),
			[]
		)
	} finally {
		actor.stop()
	}
})

test('ranged skirmish cleanup clears owned control states', async () => {
	const bot = new CombatBot()
	bot.inventoryItems = [{ name: 'bow' }, { name: 'arrow' }]
	const actor = createRuntimeActor(bot)

	try {
		await enterCombat(actor, createEnemy(12))
		await delay(300)

		assert.equal(bot.controlStates.get('forward'), true)
		assert.equal(bot.controlStates.get('sprint'), true)
		assert.equal(bot.controlStates.get('jump'), true)

		actor.send({ type: 'STOP_COMBAT' })
		await delay(0)
		await delay(0)

		assert.equal(actor.getSnapshot().context.movementOwner, 'NONE')
		assert.equal(bot.controlStates.get('forward'), false)
		assert.equal(bot.controlStates.get('sprint'), false)
		assert.equal(bot.controlStates.get('jump'), false)
	} finally {
		actor.stop()
	}
})

test('ranged skirmish degrades to owner NONE when movement plugin is unavailable', async () => {
	const bot = new NoMovementCombatBot()
	bot.inventoryItems = [{ name: 'bow' }, { name: 'arrow' }]
	const actor = createRuntimeActor(bot)

	try {
		await enterCombat(actor, createEnemy(12))
		await delay(300)

		assert.equal(
			actor.getSnapshot().matches({
				MAIN_ACTIVITY: { COMBAT: 'RANGED_SKIRMISHING' }
			} as never),
			true
		)
		assert.equal(actor.getSnapshot().context.movementOwner, 'NONE')
		assert.equal(bot.hawkEyeAttackCalls > 0, true)
	} finally {
		actor.stop()
	}
})

test('combat hands off from melee to ranged skirmish without overlap', async () => {
	const bot = new CombatBot()
	bot.inventoryItems = [
		{ name: 'iron_sword' },
		{ name: 'bow' },
		{ name: 'arrow' }
	]
	const actor = createRuntimeActor(bot)

	try {
		await enterCombat(actor, createEnemy(2))
		await delay(550)

		assert.equal(bot.pvpAttackCalls > 0, true)

		await enterCombat(actor, createEnemy(12))
		await delay(350)

		assert.equal(
			actor.getSnapshot().matches({
				MAIN_ACTIVITY: { COMBAT: 'RANGED_SKIRMISHING' }
			} as never),
			true
		)
		assert.equal(actor.getSnapshot().context.movementOwner, 'MOVEMENT')
		assert.equal(bot.pvpStopCalls > 0, true)
		assert.equal(bot.hawkEyeAttackCalls > 0, true)
	} finally {
		actor.stop()
	}
})

test('combat hands off from ranged skirmish back to melee without overlap', async () => {
	const bot = new CombatBot()
	bot.inventoryItems = [
		{ name: 'iron_sword' },
		{ name: 'bow' },
		{ name: 'arrow' }
	]
	const actor = createRuntimeActor(bot)

	try {
		await enterCombat(actor, createEnemy(12))
		await delay(350)

		assert.equal(bot.hawkEyeAttackCalls > 0, true)

		await enterCombat(actor, createEnemy(2))
		await delay(600)

		assert.equal(
			actor.getSnapshot().matches({
				MAIN_ACTIVITY: { COMBAT: 'MELEE_ATTACKING' }
			} as never),
			true
		)
		assert.equal(actor.getSnapshot().context.movementOwner, 'PVP')
		assert.equal(bot.hawkEyeStopCalls > 0, true)
		assert.equal(bot.pvpAttackCalls > 0, true)
	} finally {
		actor.stop()
	}
})

test('combat does not re-enter melee on repeated entity updates for the same close target', async () => {
	const bot = new CombatBot()
	bot.inventoryItems = [{ name: 'iron_sword' }]
	const actor = createRuntimeActor(bot)
	const enemy = createEnemy(2)

	try {
		await enterCombat(actor, enemy)
		await delay(600)

		assert.deepEqual(bot.equipCalls, ['iron_sword'])
		assert.equal(
			actor.getSnapshot().matches({
				MAIN_ACTIVITY: { COMBAT: 'MELEE_ATTACKING' }
			} as never),
			true
		)

		await enterCombat(actor, enemy)
		await delay(600)

		assert.deepEqual(
			bot.equipCalls,
			['iron_sword'],
			'expected repeated UPDATE_ENTITIES to keep current melee invoke alive'
		)
		assert.equal(
			actor.getSnapshot().matches({
				MAIN_ACTIVITY: { COMBAT: 'MELEE_ATTACKING' }
			} as never),
			true
		)
	} finally {
		actor.stop()
	}
})

test('ranged skirmish re-equips when weapon instance changes but type stays the same', async () => {
	const bot = new CombatBot()
	const firstBow = { name: 'bow' }
	const secondBow = { name: 'bow' }
	let currentWeapon = firstBow
	bot.inventoryItems = [{ name: 'arrow' }]
	bot.utils.getRangeWeapon = () => currentWeapon as any
	const actor = createRuntimeActor(bot)

	try {
		await enterCombat(actor, createEnemy(12))
		await delay(350)

		assert.deepEqual(bot.equipCalls, ['bow'])

		currentWeapon = secondBow
		await delay(350)

		assert.deepEqual(bot.equipCalls, ['bow', 'bow'])
		assert.equal(bot.hawkEyeAttackCalls >= 2, true)
	} finally {
		actor.stop()
	}
})

test('delayed ranged equip does not continue combat startup after STOP_COMBAT', async () => {
	const bot = new DelayedEquipCombatBot()
	bot.inventoryItems = [{ name: 'bow' }, { name: 'arrow' }]
	const actor = createRuntimeActor(bot)
	const originalConsoleLog = console.log
	const capturedLogs: string[] = []

	console.log = (...args: unknown[]) => {
		capturedLogs.push(args.map(arg => String(arg)).join(' '))
	}

	try {
		await enterCombat(actor, createEnemy(12))
		actor.send({ type: 'STOP_COMBAT' })
		await delay(150)

		assert.deepEqual(bot.equipCalls, ['bow'])
		assert.equal(
			capturedLogs.some(message => message.includes('Экипировал: bow')),
			false
		)
		assert.equal(bot.hawkEyeAttackCalls, 0)
	} finally {
		console.log = originalConsoleLog
		actor.stop()
	}
})
