import type { HawkEye } from 'minecrafthawkeye'
import type { EatUtil } from 'mineflayer-auto-eat/dist/new.js'
import type { Movements, Pathfinder } from 'mineflayer-pathfinder'
import type { Block } from 'prismarine-block'
import type { Entity } from 'prismarine-entity'
import type { Recipe } from 'prismarine-recipe'
import type { Vec3 } from 'vec3'

import type { MemoryManager } from '@/core/memory/index.js'

export type { Item } from 'prismarine-item'
export type { Entity, EntityType } from 'prismarine-entity'
export type { Block } from 'prismarine-block'
export type { Vec3 } from 'vec3'
export type { Pathfinder } from 'mineflayer-pathfinder'

export type WinstonLogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface Bot {
	username: string
	entity: any
	entities: { [id: string]: Entity }
	health: number
	food: number
	foodSaturation: number
	oxygenLevel: number
	inventory: {
		slots: any[]
		items(): any[]
	}
	heldItem: any
	registry: any
	movement: any
	game?: {
		dimension?: string
	}
	time?: {
		timeOfDay?: number
		isDay?: boolean
	}

	on: (event: string, listener: (...args: any[]) => void) => this
	once: (event: string, listener: (...args: any[]) => void) => this
	off: (event: string, listener: (...args: any[]) => void) => this
	emit: (event: string, ...args: any[]) => boolean
	chat: (message: string) => void
	quit: (reason?: string) => void
	loadPlugin: (plugin: any) => void
	dig: (
		block: Block,
		forceLook?: boolean | 'ignore' | 'raycast'
	) => Promise<void>
	placeBlock: (referenceBlock: Block, faceVector: Vec3) => Promise<void>
	equip: (item: any, destination: string) => Promise<void>
	consume: () => Promise<void>
	craft: (
		recipe: Recipe,
		count: number,
		craftingTable: Block | null
	) => Promise<void>
	recipesFor: (
		itemId: number,
		metadata: number | null,
		minResultCount: number | null,
		craftingTable: Block | null
	) => Recipe[]
	sleep: (bed: Block) => Promise<void>
	blockAt: (point: any, extraInfos?: boolean) => Block | null
	findBlocks: (options: any) => any[]
	nearestEntity: (match?: (entity: Entity) => boolean) => Entity | null
	setControlState: (
		control:
			| 'forward'
			| 'back'
			| 'left'
			| 'right'
			| 'jump'
			| 'sprint'
			| 'sneak',
		state: boolean
	) => void
	getEquipmentDestSlot: (
		destination: 'hand' | 'off-hand' | 'head' | 'torso' | 'legs' | 'feet'
	) => number
	openChest: (block: Block) => Promise<any>
	openContainer: (block: Block) => Promise<any>
	openFurnace: (block: Block) => Promise<any>
	openBlock: (block: Block) => Promise<any>
	closeWindow: (window: any) => void

	autoEat: EatUtil
	pathfinder: Pathfinder
	movements: Movements
	hawkEye: HawkEye
	tool: any
	armorManager: any
	pvp: any

	utils: import('../utils/minecraft/botUtils').BotUtils
	hsm: import('../core/hsm').default
	memory: MemoryManager
}
