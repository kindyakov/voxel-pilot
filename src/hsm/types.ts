import type { Block, Bot, Entity, Vec3 } from '@types'

import type { MachineContext } from '@hsm/context'

export type HealthEvents =
	| { type: 'UPDATE_HEALTH'; health: number }
	| { type: 'UPDATE_FOOD'; food: number }
	| { type: 'UPDATE_SATURATION'; foodSaturation: number }
	| { type: 'UPDATE_OXYGEN'; oxygenLevel: number }
	| { type: 'FOOD_RESTORED' }
	| { type: 'HEALTH_RESTORED' }
	| { type: 'START_URGENT_NEEDS'; need: 'food' | 'health' }

export type CombatEvents =
	| { type: 'START_COMBAT'; target: Entity | null }
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

export type UserEvents =
	| { type: 'USER_COMMAND'; username: string; text: string }
	| { type: 'STOP_CURRENT_GOAL'; username?: string }

export type PrimitiveEvents =
	| { type: 'FOUND_FOOD' }
	| { type: 'NOT_FOUND'; reason: string }
	| { type: 'FOUND'; block?: Block; entity?: Entity }
	| { type: 'SUCCESSFULLY' }
	| { type: 'ARRIVED' }
	| { type: 'NAVIGATION_FAILED'; reason?: string }
	| { type: 'BROKEN' }
	| { type: 'BREAKING_FAILED'; reason?: string }
	| { type: 'OPENED'; container: any; block: Block }
	| { type: 'OPEN_FAILED'; reason: string }
	| { type: 'CRAFTED'; itemName: string; count: number }
	| { type: 'CRAFT_FAILED'; reason: string }
	| {
			type: 'SMELTED'
			inputItemName: string
			count: number
			outputItem: string | null
	  }
	| { type: 'SMELT_FAILED'; reason: string }
	| { type: 'PLACED'; blockName: string; position: Vec3 }
	| { type: 'PLACING_FAILED'; reason: string }
	| { type: 'FOLLOWING_STOPPED'; reason: string }
	| { type: 'FOLLOWING_FAILED'; reason: string }
	| { type: 'WOKE_UP' }
	| { type: 'SLEEP_FAILED'; reason: string }

export type SystemEvents = { type: 'ERROR'; error: string }

export type MachineEvent =
	| HealthEvents
	| CombatEvents
	| UpdateEvents
	| UserEvents
	| PrimitiveEvents
	| SystemEvents

type MachineGuard = (args: {
	context: MachineContext
	event: MachineEvent
}) => boolean

type MachineAction = (args: {
	context: MachineContext
	event: MachineEvent
}) => void | Partial<MachineContext>

type AssignAction = (args: {
	context: MachineContext
	event: MachineEvent
}) => Partial<MachineContext>

type MachineActionParams = {
	context: MachineContext
	event: MachineEvent
}

export type MachineGuardParams = {
	context: MachineContext
	event: MachineEvent
}

interface TaskParams {
	[key: string]: any
}

interface TaskPreconditions {
	tool?: string
	inventory_space?: boolean
	furnace?: 'nearby'
	crafting_table?: 'nearby'
	materials?: Record<string, number>
}

interface TaskValidationResult {
	valid: boolean
	missing: string[]
	suggestions: TaskSuggestion[]
}

interface TaskSuggestion {
	action: string
	params: TaskParams
}

interface TaskDefinition {
	name: string
	description: string
	required_params: string[]
	optional_params: string[]
	primitives_used: string[]
	preconditions: TaskPreconditions
	canExecute: (bot: Bot, params: TaskParams) => TaskValidationResult
	events_emitted: string[]
}

type TaskRegistry = Record<string, TaskDefinition>
