import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'

import { Vec3 } from 'vec3'
import { createActor, fromPromise } from 'xstate'

import type { Item } from '@/types'

import { createBotMachine } from '../../hsm/machine.js'
import { ItemFactory, registry } from './fixtures/handoffBot'
import { publishEntities } from './fixtures/publishEntities'

const hangingActor = fromPromise(async () => {
	return await new Promise<never>(() => {})
})

const noopActor = fromPromise(async () => {})

const createItem = (name: string): Item =>
	new ItemFactory(registry.itemsByName[name].id, 1)

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
	inventoryItems: Item[] = []
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
		slots: Array<Item | null>(46).fill(null),
		items: () => this.inventoryItems
	}
	registry = registry
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
	get heldItem() {
		return this.inventory.slots[36] ?? null
	}
	async equip(item: Item) {
		this.equipCalls.push(item.name)
		this.inventory.slots[36] = item
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
	override async equip(item: Item) {
		this.equipCalls.push(item.name)
		await delay(100)
		this.inventory.slots[36] = item
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

test('a rejected ranged equip falls back once and stays in melee for this encounter', async () => {
	const bot = new CombatBot()
	bot.inventoryItems = [
		createItem('bow'),
		createItem('arrow'),
		createItem('iron_sword')
	]
	bot.equip = async item => {
		bot.equipCalls.push(item.name)
		if (item.name === 'bow') throw new Error('equip rejected')
		bot.inventory.slots[36] = item
	}
	const actor = createRuntimeActor(bot)
	try {
		await enterCombat(actor, createEnemy(8))
		await delay(700)
		assert.equal(bot.equipCalls.filter(name => name === 'bow').length, 1)
		assert.equal(
			actor
				.getSnapshot()
				.matches({ MAIN_ACTIVITY: { COMBAT: 'MELEE_ATTACKING' } }),
			true
		)
		assert.equal(actor.getSnapshot().context.rangedUnavailable, true)
		actor.send({ type: 'STOP_COMBAT' })
		actor.send({ type: 'START_COMBAT', target: createEnemy(8) as any })
		await delay(20)
		assert.equal(bot.equipCalls.filter(name => name === 'bow').length, 2)
	} finally {
		actor.stop()
	}
})

test('a combat callback error waits without restarting the failed controller or fleeing', async () => {
	const bot = new CombatBot()
	bot.inventoryItems = [createItem('iron_sword')]
	bot.pvp.attack = () => {
		throw new Error('attack controller failed')
	}
	const actor = createRuntimeActor(bot)
	try {
		await enterCombat(actor, createEnemy(2))
		await delay(700)
		assert.equal(
			actor.getSnapshot().matches({ MAIN_ACTIVITY: { COMBAT: 'WAITING' } }),
			true
		)
		assert.match(
			actor.getSnapshot().context.lastReason ?? '',
			/attack controller failed/
		)
		assert.equal(actor.getSnapshot().context.approachAttempts[1]?.blocked, true)
	} finally {
		actor.stop()
	}
})

const createSurvivalRuntimeActor = (bot: CombatBot) => {
	const actor = createActor(
		createBotMachine({
			thinkingActor: hangingActor,
			actors: {
				serviceEntitiesTracking: noopActor,
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
	publishEntities(actor, {
		type: 'UPDATE_ENTITIES',
		entities: [enemy as any],
		enemies: [enemy as any],
		players: [],
		combatTarget: {
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
	bot.inventoryItems = [createItem('iron_sword')]
	const actor = createRuntimeActor(bot)

	try {
		await enterCombat(actor, createEnemy(2))
		await delay(550)

		assert.equal(bot.pvpAttackCalls > 0, true)

		actor.send({ type: 'STOP_COMBAT' })
		await delay(0)
		await delay(0)

		assert.equal(bot.pvpForceStopCalls > 0, true)
	} finally {
		actor.stop()
	}
})

test('STOP_COMBAT cleans up active ranged combat', async () => {
	const bot = new CombatBot()
	bot.inventoryItems = [createItem('bow'), createItem('arrow')]
	const actor = createRuntimeActor(bot)

	try {
		await enterCombat(actor, createEnemy(8))
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

test('ranged skirmish owns only ranged attacks and leaves movement idle', async () => {
	const bot = new CombatBot()
	bot.inventoryItems = [createItem('bow'), createItem('arrow')]
	const actor = createRuntimeActor(bot)

	try {
		await enterCombat(actor, createEnemy(8))
		await delay(300)

		assert.equal(
			actor.getSnapshot().matches({
				MAIN_ACTIVITY: { COMBAT: 'RANGED_SKIRMISHING' }
			} as never),
			true
		)
		assert.equal(actor.getSnapshot().context.movementOwner, 'NONE')
		assert.equal(bot.hawkEyeAttackCalls > 0, true)
		assert.equal(bot.movementSetGoalCalls.length, 0)
		assert.equal(bot.movementSteerCalls.length, 0)
		assert.equal(bot.controlStates.get('forward'), undefined)
		assert.equal(bot.controlStates.get('sprint'), undefined)
		assert.equal(bot.controlStates.get('jump'), undefined)
		assert.deepEqual(
			bot.pathfinderSetGoalCalls.filter(goal => goal !== null),
			[]
		)
	} finally {
		actor.stop()
	}
})

test('ranged skirmish does not require the movement plugin', async () => {
	const bot = new NoMovementCombatBot()
	bot.inventoryItems = [createItem('bow'), createItem('arrow')]
	const actor = createRuntimeActor(bot)

	try {
		await enterCombat(actor, createEnemy(8))
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
		createItem('iron_sword'),
		createItem('bow'),
		createItem('arrow')
	]
	const actor = createRuntimeActor(bot)

	try {
		await enterCombat(actor, createEnemy(2))
		await delay(550)

		assert.equal(bot.pvpAttackCalls > 0, true)

		await enterCombat(actor, createEnemy(8))
		await delay(350)

		assert.equal(
			actor.getSnapshot().matches({
				MAIN_ACTIVITY: { COMBAT: 'RANGED_SKIRMISHING' }
			} as never),
			true
		)
		assert.equal(actor.getSnapshot().context.movementOwner, 'NONE')
		assert.equal(bot.pvpForceStopCalls > 0, true)
		assert.equal(bot.hawkEyeAttackCalls > 0, true)
	} finally {
		actor.stop()
	}
})

test('combat hands off from ranged skirmish back to melee without overlap', async () => {
	const bot = new CombatBot()
	bot.inventoryItems = [
		createItem('iron_sword'),
		createItem('bow'),
		createItem('arrow')
	]
	const actor = createRuntimeActor(bot)

	try {
		await enterCombat(actor, createEnemy(8))
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
	bot.inventoryItems = [createItem('iron_sword')]
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

test('ranged skirmish preserves shooting when inventory refresh replaces the same bow object', async () => {
	const bot = new CombatBot()
	const firstBow = createItem('bow')
	const secondBow = createItem('bow')
	bot.inventoryItems = [firstBow, createItem('arrow')]
	const actor = createRuntimeActor(bot)

	try {
		await enterCombat(actor, createEnemy(8))
		await delay(350)

		assert.deepEqual(bot.equipCalls, ['bow'])

		bot.inventoryItems[0] = secondBow
		bot.inventory.slots[36] = secondBow
		await delay(350)

		assert.deepEqual(bot.equipCalls, ['bow'])
		assert.equal(bot.hawkEyeAttackCalls, 1)
	} finally {
		actor.stop()
	}
})

test('delayed ranged equip does not continue combat startup after STOP_COMBAT', async () => {
	const bot = new DelayedEquipCombatBot()
	bot.inventoryItems = [createItem('bow'), createItem('arrow')]
	const actor = createRuntimeActor(bot)

	try {
		await enterCombat(actor, createEnemy(8))
		actor.send({ type: 'STOP_COMBAT' })
		await delay(150)

		assert.deepEqual(bot.equipCalls, ['bow'])
		assert.equal(bot.hawkEyeAttackCalls, 0)
		assert.equal(bot.pvpAttackCalls, 0)
		assert.equal(
			actor.getSnapshot().matches({ MAIN_ACTIVITY: 'IDLE' } as never),
			true
		)
	} finally {
		actor.stop()
	}
})
