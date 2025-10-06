import type { Vec3, Item, Block } from '../../types'

// ============================================
// MINING
// ============================================
export interface MiningParams {
	ore: string
	count: number
	maxDistance?: number
}

export interface MiningTaskData {
	targetBlock: string
	targetCount: number
	progress: {
		found: number
		currentBlock: Block | null
	}
}

// ============================================
// SMELTING
// ============================================
export interface SmeltingParams {
	input: string
	output: string
	count: number
	fuel?: string
}

export interface SmeltingTaskData {
	inputItem: string
	outputItem: string
	targetCount: number
	furnace: Block | null
	progress: {
		smelted: number
	}
}

// ============================================
// CRAFTING
// ============================================
export interface CraftingParams {
	recipe: string
	count: number
	craftingTable?: boolean
}

export interface CraftingTaskData {
	recipe: string
	targetCount: number
	craftingTable: Block | null
	progress: {
		crafted: number
	}
}

// ============================================
// BUILDING
// ============================================
export interface BuildingParams {
	structure: string
	location: Vec3
	blocks?: string[]
}

export interface BuildingTaskData {
	structure: string
	location: Vec3
	blocks: string[]
	progress: {
		placed: number
		total: number
	}
}

// ============================================
// DEPOSIT_ITEMS
// ============================================
export interface DepositItemsParams {
	keep_tools?: boolean
	keep_food?: boolean
	specific_items?: string[]
}

export interface DepositItemsTaskData {
	chest: Block | null
	itemsToDeposit: Item[]
}

// ============================================
// UNIONS
// ============================================

// Union всех параметров задач
export type AnyTaskParams =
	| MiningParams
	| SmeltingParams
	| CraftingParams
	| BuildingParams
	| DepositItemsParams

// Union всех taskData
export type AnyTaskData =
	| MiningTaskData
	| SmeltingTaskData
	| CraftingTaskData
	| BuildingTaskData
	| DepositItemsTaskData
