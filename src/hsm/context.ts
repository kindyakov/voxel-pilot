import type { Bot, Entity, Item, Vec3 } from '@/types/index.js'

import type { TaskState } from '@/hsm/tasks/task.js'

import type { CompletedMiningTask } from '@/ai/contracts/agentTurn.js'
import type { PendingExecution } from '@/ai/contracts/execution.js'
import type { ConversationEntry } from '@/ai/conversationHistory.js'
import {
	type GoalExecutionState,
	createGoalExecution
} from '@/ai/goalExecution.js'
import type { WindowRuntime } from '@/ai/runtime/window.js'
import type { TaskContext } from '@/ai/taskContext.js'

import type { ApproachAttempt } from '@/utils/combat/approachPolicy.js'
import type { ThreatKind } from '@/utils/combat/selfDefense.js'

export interface ThreatObservation {
	creeper: {
		swelling: boolean | null
		ignited: boolean | null
		powered: boolean | null
		disengaged: boolean
	} | null
	kind: ThreatKind
	entityId: number
	position: Vec3
	distance: number
	lastObservedAt: number
	observed: boolean
}

export type RecoveryRelocation =
	| { status: 'pending'; sourcePosition: Vec3 | null }
	| { status: 'planned'; from: Vec3; goal: Vec3 }

export interface MachineContext {
	bot: Bot | null
	health: number
	recoveryRelocation: RecoveryRelocation | null
	aggressionByEntity: Record<number, number>
	/** Death is terminal for this entity object, not for a reusable server ID. */
	deadEntities: ReadonlySet<Entity>
	recoveryNoFoodNotified: boolean
	threatObservationAt: number | null
	threatObservationProblem:
		| 'invalid_bot_position'
		| 'invalid_entity_position'
		| 'observer_failed'
		| null
	lastDamage: {
		sequence: number
		observedAt: number
		sourceId: number | null
		sourcePosition: Vec3 | null
	}
	food: number
	oxygenLevel: number
	foodSaturation: number

	weather: string | null
	timeOfDay: number | null
	entities: Entity[]
	enemies: Entity[]
	players: Entity[]
	nearestThreat: ThreatObservation | null
	threats: ThreatObservation[]

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
		idleGazeRadius: number
		maxDistToEnemy: number
		maxObservDist: number
		threatRetentionMs: number
		combatMode: 'defensive' | 'attack' | 'retreat'
		safeEatDistance: number
		interruptEatDistance: number
		fleeTargetDistance: number
		safePlayerDistance: number
		fleeToPlayerRadius: number
		enemyMeleeRange: number
		rangedAttackRange: number
		selfDefenseDistance: number
		creeperDangerDistance: number
		creeperRetreatDistance: number
		aggressionRetentionMs: number
		maxCountSlotsInInventory: number
		foodEmergency: number
		foodRestored: number
		healthEmergency: number
		healthFullyRestored: number
		recoveryRetryMs: number
		pausedGoalRetryMs: number
		escapeNoProgressMs: number
		movementProgressDistance: number
		escapeThreatChangeDistance: number
		escapeRouteAttempts: number
		escapeRouteTimeoutMs: number
		escapeSearchSliceMs: number
		approachNoProgressMs: number
		approachRouteAttempts: number
		approachChangedConditionRetries: number
		approachForgetMs: number
		pathfindTimeout: number
		maxPathLengthMultiplier: number
		pathfindCacheDuration: number
		miningSearchMaxDistance: number
		miningMaxYAbove: number
		miningMaxYBelow: number
		miningMaxBlockAttempts: number
		miningMaxTotalSearches: number
	}

	combatTarget: {
		entity: Entity | null
		distance: number
	}
	movementOwner: 'NONE' | 'PATHFINDER' | 'PVP' | 'MOVEMENT'
	preferredCombatTargetId: number | null
	combatStopRequested: boolean
	combatNoWeaponNotified: boolean
	rangedUnavailable: boolean
	approachAttempts: Record<number, ApproachAttempt>
	recoveryFailure: 'no_food' | 'error' | null

	isActiveTask: boolean
	taskData: TaskState | null
	plan: unknown | null
	pausedPlan: unknown | null
	savedTaskState: unknown | null

	currentGoal: string | null
	pausedGoal: string | null
	aiPilotEnabled: boolean
	subGoal: string | null
	conversationHistory: ConversationEntry[]
	taskContext: TaskContext
	lastAction: string | null
	lastActionArgs: Record<string, unknown> | null
	completedMiningTasks: CompletedMiningTask[]
	lastResult: 'SUCCESS' | 'FAILED' | null
	lastReason: string | null
	errorHistory: string[]
	pendingExecution: PendingExecution | null
	windows: WindowRuntime | null
	lastToolTranscript: string[]
	goalExecution: GoalExecutionState
}

export const context: MachineContext = {
	bot: null,
	health: 20,
	recoveryRelocation: null,
	aggressionByEntity: {},
	deadEntities: new Set(),
	recoveryNoFoodNotified: false,
	threatObservationAt: null,
	threatObservationProblem: null,
	lastDamage: {
		sequence: 0,
		observedAt: 0,
		sourceId: null,
		sourcePosition: null
	},
	food: 20,
	oxygenLevel: 20,
	foodSaturation: 5,

	weather: null,
	timeOfDay: null,
	entities: [],
	enemies: [],
	players: [],
	nearestThreat: null,
	threats: [],

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
		idleGazeRadius: 8,
		maxDistToEnemy: 20,
		maxObservDist: 50,
		threatRetentionMs: 2000,
		combatMode: 'defensive',
		safeEatDistance: 30,
		interruptEatDistance: 20,
		fleeTargetDistance: 15,
		safePlayerDistance: 10,
		fleeToPlayerRadius: 50,
		enemyMeleeRange: 5,
		rangedAttackRange: 25,
		selfDefenseDistance: 8,
		creeperDangerDistance: 12,
		creeperRetreatDistance: 16,
		aggressionRetentionMs: 10000,
		maxCountSlotsInInventory: 45,
		foodEmergency: 6,
		foodRestored: 18,
		healthEmergency: 10,
		healthFullyRestored: 18,
		recoveryRetryMs: 1000,
		pausedGoalRetryMs: 30_000,
		escapeNoProgressMs: 1500,
		movementProgressDistance: 0.75,
		escapeThreatChangeDistance: 3,
		escapeRouteAttempts: 8,
		escapeRouteTimeoutMs: 200,
		escapeSearchSliceMs: 10,
		approachNoProgressMs: 3000,
		approachRouteAttempts: 3,
		approachChangedConditionRetries: 2,
		approachForgetMs: 30000,
		pathfindTimeout: 800,
		maxPathLengthMultiplier: 2,
		pathfindCacheDuration: 3000,
		miningSearchMaxDistance: 64,
		miningMaxYAbove: 6,
		miningMaxYBelow: 2,
		miningMaxBlockAttempts: 2,
		miningMaxTotalSearches: 20
	},

	combatTarget: {
		entity: null,
		distance: Infinity
	},
	movementOwner: 'NONE',
	preferredCombatTargetId: null,
	combatStopRequested: false,
	combatNoWeaponNotified: false,
	rangedUnavailable: false,
	approachAttempts: {},
	recoveryFailure: null,

	isActiveTask: false,
	taskData: null,
	plan: null,
	pausedPlan: null,
	savedTaskState: null,

	currentGoal: null,
	pausedGoal: null,
	aiPilotEnabled: true,
	subGoal: null,
	conversationHistory: [],
	taskContext: {
		category: 'unknown'
	},
	lastAction: null,
	lastActionArgs: null,
	completedMiningTasks: [],
	lastResult: null,
	lastReason: null,
	errorHistory: [],
	pendingExecution: null,
	windows: null,
	lastToolTranscript: [],
	goalExecution: createGoalExecution()
}
