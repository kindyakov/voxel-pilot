// Реэкспортируем типы из модулей для удобства
import type * as Mineflayer from 'mineflayer'
import type { EatUtil } from 'mineflayer-auto-eat/dist/new.js'
import type { Pathfinder, Movements } from 'mineflayer-pathfinder'
import type { HawkEye } from 'minecrafthawkeye'
import type { Block } from 'prismarine-block'
import type { Entity } from 'prismarine-entity'

export type { Item } from 'prismarine-item'
export type { Entity, EntityType } from 'prismarine-entity'
export type { Block } from 'prismarine-block'
export type { Vec3 } from 'vec3'
export type { Pathfinder, goals } from 'mineflayer-pathfinder'

export type WinstonLogLevel = 'debug' | 'info' | 'warn' | 'error'

// Extend Bot type with custom properties
export interface Bot {
	// Base mineflayer properties (essential ones)
	username: string
	entity: any
	entities: { [id: string]: Entity }
	health: number
	food: number
	foodSaturation: number
	oxygenLevel: number
	inventory: any
	heldItem: any
	registry: any
	movement: any

	// Methods
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
	equip: (item: any, destination: string) => Promise<void>
	consume: () => Promise<void>
	blockAt: (point: any, extraInfos?: boolean) => Block | null
	findBlocks: (options: any) => any[]
	nearestEntity: (match?: (entity: Entity) => boolean) => Entity | null
	setControlState: (
		control: 'forward' | 'back' | 'left' | 'right' | 'jump' | 'sprint' | 'sneak',
		state: boolean
	) => void

	// Plugins
	autoEat: EatUtil
	pathfinder: Pathfinder
	movements: Movements
	hawkEye: HawkEye

	tool: any

	armorManager: any

	pvp: any

	// Custom utilities
	utils: import('../utils/minecraft/botUtils').BotUtils
	hsm: import('../core/hsm').default
	memory: import('../core/memory').default
}
