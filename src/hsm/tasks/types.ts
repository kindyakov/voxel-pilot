import type { Vec3, Item, Block, Entity } from '@types'

export interface Plan {
	goal: string
	priority: number
	tasks: Task[]
	currentIndex?: number // Для executor
}

type TaskType =
	| 'MINING'
	| 'SMELTING'
	| 'CRAFTING'
	| 'BUILDING'
	| 'FOLLOWING'
	| 'SLEEPING'
	| 'FARMING'
	| 'deposit_items'

export interface Task {
	type: TaskType
	params: Record<string, unknown>
}

// ============================================
// MINING
// ============================================
export interface MiningTaskData {
	blockName: string
	count?: number
	collected?: number
	targetBlock?: Block
	maxDistance?: number
	navigationAttempts: number
	lastMinedPosition?: Vec3
}

// ============================================
// SMELTING
// ============================================
export interface SmeltingTaskData {
	inputItem: string
	outputItem: string
	fuel: string
	count: number
	smelted: number
}

// ============================================
// CRAFTING
// ============================================
export interface CraftingTaskData {
	recipe: string
	count: number
	crafted: number
}

// ============================================
// BUILDING
// ============================================
export interface BuildingTaskData {
	structure: string
	location: Vec3
	blocks: string[]
}

// ============================================
// DEPOSIT_ITEMS
// ============================================
export interface DepositItemsTaskData {
	chest: Block | null
	itemsToDeposit: Item[]
}

// ============================================
// FOLLOWING
// ============================================
export interface FollowingTaskData {
	entityName?: string // Название существа (cow, zombie) - найдет ближайшее
	entityType?: string // Тип существа (hostile, animal, mob) - найдет ближайшее
	distance?: number // Дистанция следования (по умолчанию 3)
	maxDistance?: number // Максимальная дистанция поиска (по умолчанию 32)
	targetEntity?: Entity // Найденная цель для следования
}

// ============================================
// UNIONS
// ============================================

// Union всех taskData
export type AnyTaskData =
	| MiningTaskData
	| SmeltingTaskData
	| CraftingTaskData
	| BuildingTaskData
	| DepositItemsTaskData
	| FollowingTaskData
