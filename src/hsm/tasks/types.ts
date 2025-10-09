import type { Vec3, Item, Block } from '@types'

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
	| 'deposit_items'

export interface Task {
	type: TaskType
	params: Record<string, unknown>
}

// ============================================
// MINING
// ============================================
export interface MiningTaskData {
	blockType: string
	count: number
	collected: number
	targetBlock?: Block
	maxDistance?: number
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
// UNIONS
// ============================================

// Union всех taskData
export type AnyTaskData =
	| MiningTaskData
	| SmeltingTaskData
	| CraftingTaskData
	| BuildingTaskData
	| DepositItemsTaskData
