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

export type CombatEvents =
	| { type: 'START_COMBAT'; target: Entity }
	| { type: 'STOP_COMBAT' }
	| { type: 'WEAPON_BROKEN' }

export type PositionEvents =
	| { type: 'UPDATE_POSITION'; position: Vec3 }
	| { type: 'DEATH' }
	| { type: 'REMOVE_ENTITY'; entity: Entity }

export type BotEvents = 
	| { type: 'SET_BOT'; bot: Bot } 
	| { type: 'PLAYER_STOP' }

// ✅ События задач
export type TaskEvents =
	| { type: 'START_TASK'; taskName: string; params: AnyTaskParams }
	| { type: 'TASK_COMPLETED'; result?: any }
	| { type: 'TASK_FAILED'; reason: string }
	| { type: 'TASK_PAUSED' }
	| { type: 'TASK_RESUMED' }

// ✅ Финальный union всех событий
export type MachineEvent =
	| HealthEvents
	| CombatEvents
	| PositionEvents
	| BotEvents
	| TaskEvents

// ============================================
// УТИЛИТАРНЫЕ ТИПЫ
// ============================================

export type GuardParams = {
	context: MachineContext
	event?: MachineEvent
}

export type ActionParams = {
	context: MachineContext
	event: MachineEvent
}

export type AssignAction = (params: ActionParams) => Partial<MachineContext>

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
