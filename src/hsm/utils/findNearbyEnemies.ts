import type { Entity } from '../../types/index'
import type { MachineContext } from '../context'

// Находим ближайшего врага
export function findNearbyEnemies({
	enemies,
	preferences,
	position
}: MachineContext): Entity[] {
	return enemies
		.filter(
			enemy =>
				enemy.position &&
				enemy.position.distanceTo(position) <= preferences.maxDistToEnemy
		) // фильтруем врагов по максимальной дистанции бота
		.reduce((closest, enemy: Entity) => {
			if (!closest) return enemy

			const currentDistance = enemy.position.distanceTo(position)
			const closestDistance = closest.position.distanceTo(position)

			return currentDistance < closestDistance ? enemy : closest
		}, null)
}
