import { assign } from 'xstate'
import { isEntityOfType } from '../../utils/isEntityOfType'
import type { Entity } from '../../../types'

const updateHealth = assign({
	health: ({ context, event }) => event.health
})

const updateFood = assign({
	food: ({ context, event }) => event.food
})

const updateEntities = assign(({ context: { bot, position, preferences } }) => {
	if (!bot?.entities || !position) return {}

	const allEntities = Object.values(bot.entities)
		.filter(
			(entity: Entity) =>
				entity &&
				entity !== bot.entity &&
				entity.position.distanceTo(position) <= preferences.maxObservDist
		)
		.sort((a, b) => {
			const distA = a.position.distanceTo(position)
			const distB = b.position.distanceTo(position)
			return distA - distB
		})

	const entities = allEntities.filter(e => !isEntityOfType(e))
	const enemies = allEntities.filter(e => isEntityOfType(e))

	return {
		entities,
		enemies,
		nearestEnemy: enemies[0]
			? {
					entity: enemies[0],
					distance: enemies[0].position.distanceTo(position)
				}
			: null
	}
})

const removeEntity = assign(({ context, event: { entity } }) => {
	const key = isEntityOfType(entity) ? 'enemies' : 'entities'

	return {
		[key]: [...context[key].filter(mob => mob.id !== entity.id)]
	}
})

export default {
	updateHealth,
	updateFood,
	updateEntities,
	removeEntity
}
