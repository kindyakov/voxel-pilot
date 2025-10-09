import type { Bot as MineflayerBot } from 'mineflayer'
import type { Block } from 'prismarine-block'

export type { Item } from 'prismarine-item'
export type { Entity, EntityType } from 'prismarine-entity'
export type { Block } from 'prismarine-block'
export type { Vec3 } from 'vec3'
export type { Pathfinder, goals } from 'mineflayer-pathfinder'

export type WinstonLogLevel = 'debug' | 'info' | 'warn' | 'error'

// Расширенный тип Bot с дополнительными методами mineflayer
export interface Bot extends MineflayerBot {
	// Registry с доступом к блокам
	registry: MineflayerBot['registry'] & {
		blocksByName: Record<string, { id: number; name: string; [key: string]: any }>
	}
	
	// Метод поиска блоков
	findBlock: (options: {
		matching: number | ((block: Block) => boolean)
		maxDistance?: number
		count?: number
		useExtraInfo?: boolean
	}) => Block | null
	
	// Метод поиска множества блоков
	findBlocks: (options: {
		matching: number | number[] | ((block: Block) => boolean)
		maxDistance?: number
		count?: number
		useExtraInfo?: boolean
	}) => Block[]
}
