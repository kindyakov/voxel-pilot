import { EventEmitter } from 'node:events'
import { createRequire } from 'node:module'

import pathfinderPackage from 'mineflayer-pathfinder'
import { Vec3 } from 'vec3'
import { createActor, fromPromise } from 'xstate'

import type { Bot, Entity, Item } from '@/types'

import { createBotMachine } from '@/hsm/machine'

import { loadMovement } from '@/modules/plugins/movement'
import { loadPvp } from '@/modules/plugins/pvp'

import { BotUtils } from '@/utils/minecraft/botUtils'

import { publishEntities } from './publishEntities'

const require = createRequire(import.meta.url)
export const registry = require('minecraft-data')('1.20.4')
export const BlockFactory = require('prismarine-block')('1.20.4')
export const ItemFactory = require('prismarine-item')('1.20.4')
const EntityFactory = require('prismarine-entity')('1.20.4')
export const createEntityFixture = (fields: Partial<Entity>): Entity =>
	Object.assign(new EntityFactory(fields.id ?? 1), fields)
const { Physics, PlayerState } = require('prismarine-physics')

export class HandoffBot extends EventEmitter {
	private blockFactory = BlockFactory
	constructor(version = '1.20.4') {
		super()
		this.version = version
		this.registry = require('minecraft-data')(version)
		this.blockFactory = require('prismarine-block')(version)
		this.physics = Physics(this.registry, {
			getBlock: (position: Vec3) => this.blockAt(position)
		})
	}
	username = 'HandoffBot'
	version = '1.20.4'
	registry = registry
	entity = {
		id: 999,
		position: new Vec3(0, 64, 0),
		velocity: new Vec3(0, 0, 0),
		height: 1.8,
		onGround: true,
		yaw: 0,
		pitch: 0,
		effects: {}
	}
	entities: Record<string, Entity> = {}
	health = 20
	food = 20
	foodSaturation = 5
	oxygenLevel = 20
	game = { dimension: 'overworld', minY: -64 }
	world = { raycast: () => null }
	time = { isDay: true, timeOfDay: 1000 }
	jumpTicks = 0
	jumpQueued = false
	fireworkRocketDuration = 0
	controlState: Record<string, boolean> = {
		forward: false,
		back: false,
		left: false,
		right: false,
		jump: false,
		sprint: false,
		sneak: false
	}
	attacks: number[] = []
	usingItem = false
	itemUses = 0
	_client = new EventEmitter()
	equipGate: Promise<void> = Promise.resolve()
	equippedItems: string[] = []
	aimGate: Promise<void> = Promise.resolve()
	digCalls: Vec3[] = []
	placeCalls: Vec3[] = []
	inventoryClicks: number[] = []
	solidAt = (position: Vec3) => position.y < 64
	physics = Physics(registry, {
		getBlock: (position: Vec3) => this.blockAt(position)
	})
	inventory = Object.assign(new EventEmitter(), {
		slots: Array<Item | null>(46).fill(null),
		selectedItem: null as Item | null,
		firstEmptyInventorySlot: () => null,
		items: (): Item[] => []
	})
	currentWindow = null
	autoEat = {
		isEating: false,
		foodsByName: {},
		opts: { bannedFood: [] },
		findBestChoices: () => []
	}
	hawkEye = { stop() {} }
	utils = new BotUtils(this.asBot())
	declare pvp: Bot['pvp']
	declare pathfinder: Bot['pathfinder']
	declare movements: Bot['movements']
	declare hsm: Bot['hsm']

	asBot() {
		// This fixture replaces the Minecraft server, not the HSM or its actors.
		return this as unknown as Bot
	}
	plugins = new Set<(bot: Bot) => void>()
	loadPlugin(plugin: (bot: Bot) => void) {
		if (this.plugins.has(plugin)) return
		this.plugins.add(plugin)
		plugin(this.asBot())
	}
	hasPlugin(plugin: (bot: Bot) => void) {
		return this.plugins.has(plugin)
	}
	chatMessages: string[] = []
	chat(message: string) {
		this.chatMessages.push(message)
	}
	nearestEntity(filter: (entity: Entity) => boolean = () => true) {
		return (
			Object.values(this.entities)
				.filter(filter)
				.sort(
					(a, b) =>
						this.entity.position.distanceTo(a.position) -
						this.entity.position.distanceTo(b.position)
				)[0] ?? null
		)
	}
	getEquipmentDestSlot(destination: string) {
		return destination === 'off-hand' ? 45 : 36 + this.quickBarSlot
	}
	quickBarSlot = 0
	QUICK_BAR_START = 36
	setQuickBarSlot(slot: number) {
		if (slot === this.quickBarSlot) return
		this.quickBarSlot = slot
		this.usingItem = false
		this.emit('heldItemChanged')
	}
	supportFeature() {
		return false
	}
	attack(target: Entity) {
		this.attacks.push(target.id)
	}
	activateItem() {
		this.usingItem = true
		this.itemUses++
	}
	deactivateItem() {
		this.usingItem = false
	}
	get heldItem() {
		return this.inventory.slots[36 + this.quickBarSlot] ?? null
	}
	async equip(item: Item, destination: string) {
		this.equippedItems.push(item.name)
		await this.equipGate
		this.inventory.slots[this.getEquipmentDestSlot(destination)] = item
	}
	async dig(block: { position: Vec3 }) {
		this.digCalls.push(block.position)
	}
	async placeBlock(block: { position: Vec3 }) {
		this.placeCalls.push(block.position)
	}
	async clickWindow(slot: number) {
		this.inventoryClicks.push(slot)
	}
	stopDigging() {
		this.emit('diggingAborted')
	}
	setControlState(control: string, active: boolean) {
		this.controlState[control] = active
	}
	clearControlStates() {
		for (const key of Object.keys(this.controlState))
			this.controlState[key] = false
	}
	async look(yaw: number, pitch: number) {
		this.entity.yaw = yaw
		this.entity.pitch = pitch
	}
	async lookAt(position: Vec3) {
		const delta = position.minus(this.entity.position)
		await this.look(Math.atan2(-delta.x, -delta.z), 0)
		await this.aimGate
	}
	blockAt(position: Vec3) {
		const block = this.blockFactory.fromStateId(
			(this.solidAt(position)
				? this.registry.blocksByName.stone
				: this.registry.blocksByName.air
			).minStateId,
			0
		)
		block.position = position.floored()
		return block
	}
}

export const createHarness = (
	backgroundTracking = false,
	version = '1.20.4'
) => {
	const bot = new HandoffBot(version)
	const VersionItem = require('prismarine-item')(version)
	const sword = new VersionItem(bot.registry.itemsByName.iron_sword.id, 1)
	sword.slot = 36
	bot.inventory.items = () => [sword]
	bot.loadPlugin(pathfinderPackage.pathfinder)
	loadPvp(bot.asBot())
	loadMovement(bot.asBot())
	bot.movements = new pathfinderPackage.Movements(bot.asBot())
	bot.pvp.movements = bot.movements
	bot.pathfinder.setMovements(bot.movements)
	const actor = createActor(
		createBotMachine({
			actors: backgroundTracking
				? {}
				: { serviceEntitiesTracking: fromPromise(async () => {}) }
		}),
		{ input: { bot: bot.asBot() } }
	)
	bot.hsm = { getContext: () => actor.getSnapshot().context } as Bot['hsm']
	actor.start()
	actor.send({ type: 'UPDATE_POSITION', position: bot.entity.position })
	const enemy = {
		id: 1,
		type: 'hostile',
		name: 'zombie',
		height: 1.8,
		position: new Vec3(2, 64, 0),
		isValid: true,
		metadata: []
	} as unknown as Entity
	const observe = () =>
		publishEntities(actor, {
			type: 'UPDATE_ENTITIES',
			entities: [enemy],
			enemies: [enemy],
			players: [],
			combatTarget: {
				entity: enemy,
				distance: bot.entity.position.distanceTo(enemy.position)
			}
		})
	const world = { getBlock: bot.blockAt.bind(bot) }
	const physics = Physics(bot.registry, world)
	const step = () => {
		bot.emit('physicsTick')
		bot.emit('physicTick')
		physics
			.simulatePlayer(new PlayerState(bot, bot.controlState), world)
			.apply(bot)
		actor.send({ type: 'UPDATE_POSITION', position: bot.entity.position })
		if (!backgroundTracking) observe()
	}
	return { bot, actor, enemy, observe, step }
}
