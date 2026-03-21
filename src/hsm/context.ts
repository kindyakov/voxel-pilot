import type { Bot, Vec3, Entity, Item } from '@types'
import type { PendingExecution } from '@/ai/tools.js'

export interface MachineContext {
	bot: Bot | null
	health: number
	food: number
	oxygenLevel: number
	foodSaturation: number

	weather: string | null
	timeOfDay: number | null
	entities: Entity[]
	enemies: Entity[]
	players: Entity[]

	inventory: Item[]
	toolDurability: {
		pickaxe: number | null
		sword: number | null
		axe: number | null
		shield: number | null
	}
	armorDurability: {
		helmet: number | null
		chestplate: number | null
		leggings: number | null
		boots: number | null
	}

	position: Vec3 | null
	spawn: Vec3 | null
	home: Vec3 | null

	preferences: {
		autoEat: boolean
		autoDefend: boolean
		followDistance: number
		maxDistToEnemy: number
		maxObservDist: number
		combatMode: 'defensive' | 'attack' | 'retreat'
		safeEatDistance: number
		fleeTargetDistance: number
		safePlayerDistance: number
		fleeToPlayerRadius: number
		enemyMeleeRange: number
		enemyRangedRange: number
		maxCountSlotsInInventory: number
		foodEmergency: number
		foodRestored: number
		healthEmergency: number
		healthFullyRestored: number
		pathfindTimeout: number
		maxPathLengthMultiplier: number
		pathfindCacheDuration: number
	}

	nearestEnemy: {
		entity: Entity | null
		distance: number
	}

	isActiveTask: boolean
	taskData: unknown | null
	plan: unknown | null
	pausedPlan: unknown | null
	savedTaskState: unknown | null

	currentGoal: string | null
	subGoal: string | null
	lastAction: string | null
	lastActionArgs: Record<string, unknown> | null
	lastResult: 'SUCCESS' | 'FAILED' | null
	lastReason: string | null
	errorHistory: string[]
	pendingExecution: PendingExecution | null
	lastToolTranscript: string[]
	failureSignature: string | null
	failureRepeats: number
}

export const context: MachineContext = {
	bot: null,
	health: 20,
	food: 20,
	oxygenLevel: 20,
	foodSaturation: 5,

	weather: null,
	timeOfDay: null,
	entities: [],
	enemies: [],
	players: [],

	inventory: [],
	toolDurability: {
		pickaxe: null,
		sword: null,
		axe: null,
		shield: null
	},
	armorDurability: {
		helmet: null,
		chestplate: null,
		leggings: null,
		boots: null
	},

	position: null,
	spawn: null,
	home: null,

	preferences: {
		autoEat: true,
		autoDefend: true,
		followDistance: 3,
		maxDistToEnemy: 20,
		maxObservDist: 50,
		combatMode: 'defensive',
		safeEatDistance: 20,
		fleeTargetDistance: 15,
		safePlayerDistance: 10,
		fleeToPlayerRadius: 50,
		enemyMeleeRange: 5,
		enemyRangedRange: 8,
		maxCountSlotsInInventory: 45,
		foodEmergency: 6,
		foodRestored: 18,
		healthEmergency: 10,
		healthFullyRestored: 18,
		pathfindTimeout: 800,
		maxPathLengthMultiplier: 2,
		pathfindCacheDuration: 3000
	},

	nearestEnemy: {
		entity: null,
		distance: Infinity
	},

	isActiveTask: false,
	taskData: null,
	plan: null,
	pausedPlan: null,
	savedTaskState: null,

	currentGoal: null,
	subGoal: null,
	lastAction: null,
	lastActionArgs: null,
	lastResult: null,
	lastReason: null,
	errorHistory: [],
	pendingExecution: null,
	lastToolTranscript: [],
	failureSignature: null,
	failureRepeats: 0
}
