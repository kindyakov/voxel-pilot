import type { MachineContext } from './context'
import type { Bot, Entity, Vec3 } from '../types'
import type { AnyTaskParams } from './tasks/types'

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
	| { type: 'UPDATE_ENTITIES' }

export type ChatEvents =
	| { type: 'mine' }
	| { type: 'follow' }
	| { type: 'sleep' }
	| { type: 'shelter' }
	| { type: 'farm' }
	| { type: 'build' }

export type BotEvents = { type: 'SET_BOT'; bot: Bot } | { type: 'PLAYER_STOP' }

export type TaskEvents =
	| { type: 'START_TASK'; taskName: string; params: AnyTaskParams }
	| { type: 'TASK_COMPLETED'; result?: any }
	| { type: 'TASK_FAILED'; reason: string }
	| { type: 'TASK_PAUSED' }
	| { type: 'TASK_RESUMED' }
	| { type: 'ITEMS_DEPOSITED' }
	| { type: 'REPAIR_COMPLETE' }
	| { type: 'FOUND_FOOD' }

export type SystemEvents = { type: 'ERROR'; error: string }

export type MachineEvent =
	| HealthEvents
	| CombatEvents
	| UpdateEvents
	| BotEvents
	| TaskEvents
	| SystemEvents
	| ChatEvents

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
