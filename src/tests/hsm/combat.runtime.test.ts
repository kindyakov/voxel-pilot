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
	hawkEyeStopCalls = 0
	hawkEyeAttackCalls = 0
	equipCalls: string[] = []
	logMessages: string[] = []
	inventory = {
		slots: Array.from({ length: 46 }, () => null),
		items: () => this.inventoryItems
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
		movements: null as unknown
	}
	utils = {
		getAllFood: () => [{ name: 'bread' }],
		eating: async () => {},
		stopEating: () => {},
		getMeleeWeapon: () => this.inventoryItems.find(item => item.name.includes('sword')) ?? null,
		getRangeWeapon: () =>
			this.inventoryItems.find(
				item =>
					item.name.includes('bow') || item.name.includes('crossbow')
			) ?? null,
		getArrow: () =>
			this.inventoryItems.find(item => item.name.includes('arrow')) ?? null,
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
		return { close() {}, containerItems() { return [] } }
	}
	async openContainer() {
		return { close() {}, containerItems() { return [] } }
	}
	async openFurnace() {
		return { close() {}, containerItems() { return [] } }
	}
	async openBlock() {
		return { close() {}, containerItems() { return [] } }
	}
	closeWindow() {}
	setControlState() {}
}

class DelayedEquipCombatBot extends CombatBot {
	override async equip(item: { name: string }) {
		this.equipCalls.push(item.name)
		await delay(100)
		this.logMessages.push(`equip resolved ${item.name}`)
	}
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
			distance: actor.getSnapshot().context.bot!.entity.position.distanceTo(enemy.position)
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
