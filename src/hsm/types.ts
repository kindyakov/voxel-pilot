import type { Block, Entity, Vec3 } from '@/types'

import type { MachineContext } from '@/hsm/context'

import type { WindowTransferResult } from '@/ai/runtime/window.js'

export type HealthEvents =
	| {
			type: 'RECOVERY_RELOCATION'
			relocation: MachineContext['recoveryRelocation']
	  }
	| { type: 'RECOVERY_FOOD_AVAILABILITY'; available: boolean }
	| {
			type: 'DAMAGE_OBSERVED'
			sourceId: number | null
			sourcePosition: Vec3 | null
	  }
	| { type: 'UPDATE_HEALTH'; health: number }
	| { type: 'UPDATE_FOOD'; food: number }
	| { type: 'UPDATE_SATURATION'; foodSaturation: number }
	| { type: 'UPDATE_OXYGEN'; oxygenLevel: number }
	| { type: 'FOOD_RESTORED' }
	| { type: 'HEALTH_RESTORED' }
	| { type: 'RECOVERY_FAILED'; reason: string; cause: 'no_food' | 'error' }
	| {
			type: 'SURVIVAL_MODE_CHANGED'
			mode: 'IDLE' | 'EATING' | 'MOVEMENT' | 'PATHFINDER'
	  }
	| { type: 'START_URGENT_NEEDS'; need: 'food' | 'health' }

export type CombatEvents =
	| { type: 'APPROACH_SAMPLE' }
	| { type: 'APPROACH_ROUTE_FAILED' }
	| { type: 'PASSABILITY_CHANGED'; position: Vec3 }
	| { type: 'RETREAT_SAFE' }
	| { type: 'START_COMBAT'; target: Entity | null }
	| { type: 'STOP_COMBAT' }
	| { type: 'WEAPON_BROKEN' }
	| { type: 'NO_ENEMIES' }
	| { type: 'ENEMY_BECAME_FAR' }
	| { type: 'ENEMY_BECAME_CLOSE' }
	| { type: 'RANGED_UNAVAILABLE'; reason: string }

export type UpdateEvents =
	| { type: 'THREAT_OBSERVATION_FAILED'; error: string }
	| {
			type: 'THREAT_OBSERVATION_INVALID'
			reason: NonNullable<MachineContext['threatObservationProblem']>
	  }
	| { type: 'UPDATE_POSITION'; position: Vec3 }
	| { type: 'DEATH' }
	| { type: 'REMOVE_ENTITY'; entity: Entity }
	| { type: 'ENTITY_DIED'; entity: Entity }
	| {
			type: 'UPDATE_ENTITIES'
			entities: Entity[]
			enemies: Entity[]
			players: Entity[]
	  }
	| {
			type: 'UPDATE_COMBAT_TARGET'
			combatTarget: { entity: Entity | null; distance: number }
	  }

export type UserEvents =
	| { type: 'USER_COMMAND'; username: string; text: string }
	| { type: 'STOP_CURRENT_GOAL'; username?: string }

export type PrimitiveEvents =
	| { type: 'NOT_FOUND'; reason: string }
	| { type: 'BLOCKS_FOUND'; blocks: Block[] }
	| { type: 'ARRIVED' }
	| { type: 'NAVIGATION_FAILED'; reason?: string }
	| { type: 'BROKEN' }
	| { type: 'BREAKING_FAILED'; reason?: string }
	| { type: 'WINDOW_OPENED' }
	| { type: 'WINDOW_OPEN_FAILED'; reason: string }
	| { type: 'WINDOW_ITEM_TRANSFERRED'; transferred: WindowTransferResult }
	| { type: 'WINDOW_TRANSFER_FAILED'; reason: string }
	| { type: 'WINDOW_CLOSED' }
	| { type: 'WINDOW_CLOSE_FAILED'; reason: string }
	| { type: 'PLACED'; blockName: string; position: Vec3 }
	| { type: 'PLACING_FAILED'; reason: string }
	| { type: 'FOLLOWING_STOPPED'; reason: string }
	| { type: 'FOLLOWING_FAILED'; reason: string }

export type SystemEvents = { type: 'ERROR'; error: string }

export type MachineEvent =
	| HealthEvents
	| CombatEvents
	| UpdateEvents
	| UserEvents
	| PrimitiveEvents
	| SystemEvents

export type MachineGuardParams = {
	context: MachineContext
	event: MachineEvent
}

export interface MiningTaskData {
	blockName: string
	count: number
	targetBlocks: Block[]
	targetIndex: number
	collected: number
	navigationAttempts: number
	breakAttempts: number
}
