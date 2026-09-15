import type { Bot as MineflayerBot } from 'mineflayer'
import type { Movements } from 'mineflayer-pathfinder'

import type { MemoryManager } from '@/core/memory/index.js'
import type { ProfileMemoryStore } from '@/core/profile/index.js'

export type { Item } from 'prismarine-item'
export type { Entity, EntityType } from 'prismarine-entity'
export type { Block } from 'prismarine-block'
export type { Vec3 } from 'vec3'
export type { Pathfinder } from 'mineflayer-pathfinder'

export type WinstonLogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface Bot extends MineflayerBot {
	movements: Movements
	utils: import('../utils/minecraft/botUtils').BotUtils
	hsm: import('../core/hsm').default
	memory: MemoryManager
	profileMemory?: ProfileMemoryStore
}
