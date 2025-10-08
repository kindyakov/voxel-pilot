import type { Entity } from '@types'
import type { MachineContext } from '@hsm/context'

/**
 * Находит ближайшего врага
 * @returns Ближайший враг или null
 */
export function findNearbyEnemies({
	enemies,
	preferences,
	position
}: MachineContext): Entity | null {
	if (!position) return null
	
	return enemies
		.filter(
			enemy =>
				enemy.position &&
				enemy.position.distanceTo(position) <= preferences.maxDistToEnemy
		)
		.reduce<Entity | null>((closest, enemy: Entity) => {
			if (!closest) return enemy

			const currentDistance = enemy.position.distanceTo(position!)
			const closestDistance = closest.position.distanceTo(position!)

			return currentDistance < closestDistance ? enemy : closest
		}, null)
}
