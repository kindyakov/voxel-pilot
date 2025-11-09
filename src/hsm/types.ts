import type { MachineContext } from '@hsm/context'
import type { Bot, Entity, Vec3, Block } from '@types'
import type { Plan, Task, AnyTaskData } from '@hsm/tasks/index'
// ============================================
// СОБЫТИЯ
// ============================================

export type HealthEvents =
	| { type: 'UPDATE_HEALTH'; health: number }
	| { type: 'UPDATE_FOOD'; food: number }
	| { type: 'UPDATE_SATURATION'; foodSaturation: number }
	| { type: 'UPDATE_OXYGEN'; oxygenLevel: number }
	| { type: 'HEALTH_RESTORED' }
	| { type: 'FOOD_RESTORED' }
	| { type: 'FOOD_SEARCH' }

export type CombatEvents =
	| { type: 'START_COMBAT'; target: Entity }
	| { type: 'STOP_COMBAT' }
	| { type: 'WEAPON_BROKEN' }
	| { type: 'NO_ENEMIES' }
	| { type: 'ENEMY_BECAME_FAR' }
	| { type: 'ENEMY_BECAME_CLOSE' }
	| { type: 'NOT_SURROUNDED' }

export type UpdateEvents =
	| { type: 'UPDATE_POSITION'; position: Vec3 }
	| { type: 'DEATH' }
	| { type: 'REMOVE_ENTITY'; entity: Entity }
	| {
			type: 'UPDATE_ENTITIES'
			entities: Entity[]
			enemies: Entity[]
			players: Entity[]
			nearestEnemy: { entity: Entity | null; distance: number }
	  }

export type ChatEvents =
	| { type: 'mine' }
	| { type: 'follow' }
	| { type: 'sleep' }
	| { type: 'shelter' }
	| { type: 'farm' }
	| { type: 'build' }

export type BotEvents = { type: 'PLAYER_STOP' }

export type PlanExecutorEvents =
	| { type: 'START_PLAN'; plan: Plan }
	| { type: 'VALIDATE_PLAN'; plan: Plan }
	| { type: 'EXECUTE_TASK'; task: Task }

export type TaskEvents =
	| { type: 'FOUND_FOOD' }
	| { type: 'NOT_FOUND'; reason: string }
	| { type: 'FOUND'; block?: Block; entity?: Entity }
	| { type: 'START_MINING'; taskData: AnyTaskData }
	| { type: 'START_FOLLOWING'; taskData: AnyTaskData }
	| { type: 'SUCCESSFULLY' }
	| { type: 'ARRIVED' }
	| { type: 'NAVIGATION_FAILED' }
	| { type: 'BROKEN' }
	| { type: 'BREAKING_FAILED'; reason?: string }
	// primitiveOpenContainer
	| { type: 'OPENED'; container: any; block: Block }
	| { type: 'OPEN_FAILED'; reason: string }
	// primitiveCraft, primitiveCraftInWorkbench
	| { type: 'CRAFTED'; itemName: string; count: number }
	| { type: 'CRAFT_FAILED'; reason: string }
	// primitiveSmelt
	| {
			type: 'SMELTED'
			inputItemName: string
			count: number
			outputItem: string | null
	  }
	| { type: 'SMELT_FAILED'; reason: string }
	// primitivePlacing
	| { type: 'PLACED'; blockName: string; position: Vec3 }
	| { type: 'PLACING_FAILED'; reason: string }
	// primitiveFollowing
	| { type: 'FOLLOWING_STOPPED'; reason: string }
	| { type: 'FOLLOWING_FAILED'; reason: string }

export type SystemEvents = { type: 'ERROR'; error: string }

export type MachineEvent =
	| HealthEvents
	| CombatEvents
	| UpdateEvents
	| BotEvents
	| TaskEvents
	| SystemEvents
	| ChatEvents
	| PlanExecutorEvents
// ============================================
// УТИЛИТАРНЫЕ ТИПЫ
// ============================================

export type MachineGuard = (args: {
	context: MachineContext
	event: MachineEvent
}) => boolean

export type MachineAction = (args: {
	context: MachineContext
	event: MachineEvent
}) => void | Partial<MachineContext>

export type AssignAction = (args: {
	context: MachineContext
	event: MachineEvent
}) => Partial<MachineContext>

export type MachineActionParams = {
	context: MachineContext
	event: MachineEvent
}

export type MachineGuardParams = {
	context: MachineContext
	event: MachineEvent
}

// ============================================
// ТИПЫ ДЛЯ TASK REGISTRY
// ============================================

export interface TaskParams {
	[key: string]: any
}

export interface TaskPreconditions {
	tool?: string
	inventory_space?: boolean
	furnace?: 'nearby'
	crafting_table?: 'nearby'
	materials?: Record<string, number>
}

export interface TaskValidationResult {
	valid: boolean
	missing: string[]
	suggestions: TaskSuggestion[]
}

export interface TaskSuggestion {
	action: string
	params: TaskParams
}

export interface TaskDefinition {
	name: string
	description: string
	required_params: string[]
	optional_params: string[]
	primitives_used: string[]
	preconditions: TaskPreconditions
	canExecute: (bot: Bot, params: TaskParams) => TaskValidationResult
	events_emitted: string[]
}

export type TaskRegistry = Record<string, TaskDefinition>
