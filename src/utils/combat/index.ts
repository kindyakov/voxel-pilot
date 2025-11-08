/**
 * Утилиты для боевой системы
 */

export {
	canSeeEnemy,
	isEnemyReachable,
	canAttackEnemy,
	clearPathfindCache,
	cleanupPathfindCache
} from './enemyVisibility'

export {
	calculateDangerCenter,
	createFleeGoal,
	updateMovementFlee,
	updatePathfinderFlee,
	switchToMovementMode,
	switchToPathfinderMode,
	switchToEatingMode,
	cleanupFleeMode,
	determineFleeMode,
	FLEE_THRESHOLDS,
	type FleeMode
} from './fleeUtils'
