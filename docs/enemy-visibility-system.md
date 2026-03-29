# Combat Visibility

This document covers the current shared combat visibility helpers in `src/utils/combat/enemyVisibility.ts`.

## Functions

- `canSeeEnemy(bot, enemy)`
- `isEnemyReachable(bot, enemy, maxPathLength, timeout, cacheDuration)`
- `canAttackEnemy(bot, enemy, maxDistance, maxPathLength, pathfindTimeout, isActiveTask)`
- `cleanupPathfindCache(maxAge)`

## Behavior

`canSeeEnemy()` does a straight-line visibility check between the bot eye position and the target.
It returns `false` when a solid block blocks the line.

`isEnemyReachable()` uses `mineflayer-pathfinder` with `canDig = false` and caches the result by entity id.
That means the bot only considers targets reachable without breaking blocks.

`canAttackEnemy()` applies the checks in order:

1. distance
2. direct visibility
3. reachability fallback

If a task is already active, the helper skips the expensive reachability check.

## Where It Is Used

- `src/hsm/guards/combat.guards.ts`
- `src/hsm/actors/combat.actors.ts`
- `src/hsm/actors/monitoring.actors.ts`
- `src/core/hsm.ts`

## Notes

- The pathfinding cache is intentionally small and time-bound.
- `cleanupPathfindCache()` should be called when the world state changes enough that cached reachability is no longer trustworthy.
