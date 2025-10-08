import { assign } from 'xstate'
import { isEntityOfType } from '@hsm/utils/isEntityOfType'
import type { Entity } from '@types'
import type { MachineActionParams } from '@hsm/types'

const updateHealth = assign({
	health: ({ event }: MachineActionParams) =>
		event.type === 'UPDATE_HEALTH' ? event.health : 20
})

const updateFood = assign({
	food: ({ event }: MachineActionParams) =>
		event.type === 'UPDATE_FOOD' ? event.food : 20
})

const updateEntities = assign(({ context }: MachineActionParams) => {
	if (!context.bot?.entities || !context.position) return {}

	const allEntities = (Object.values(context.bot.entities) as Entity[])
		.filter(
			(entity: Entity) =>
				entity &&
				entity !== context.bot?.entity &&
				entity.position &&
				entity.position.distanceTo(context.position!) <=
					context.preferences.maxObservDist
		)
		.sort((a: Entity, b: Entity) => {
			const distA = a.position.distanceTo(context.position!)
			const distB = b.position.distanceTo(context.position!)
			return distA - distB
		})

	const entities: Entity[] = allEntities.filter(e => !isEntityOfType(e))
	const enemies: Entity[] = allEntities.filter(e => isEntityOfType(e))

	return {
		entities,
		enemies,
		nearestEnemy: enemies[0]
			? {
					entity: enemies[0],
					distance: enemies[0].position.distanceTo(context.position!)
				}
			: {
					entity: null,
					distance: Infinity
				}
	}
})

const removeEntity = assign(({ context, event }: MachineActionParams) => {
	if (event.type !== 'REMOVE_ENTITY') return {}

	const { entity } = event
	const key = isEntityOfType(entity) ? 'enemies' : 'entities'

	return {
		[key]: context[key].filter((mob: Entity) => mob.id !== entity.id)
	}
})

export default {
	updateHealth,
	updateFood,
	updateEntities,
	removeEntity
}
