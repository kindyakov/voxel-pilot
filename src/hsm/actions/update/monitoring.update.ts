import { assign } from 'xstate'
import type { MachineActionParams } from '@hsm/types'

const updateHealth = assign({
	health: ({ event }: MachineActionParams) =>
		event.type === 'UPDATE_HEALTH' ? event.health : 20
})

const updateFood = assign({
	food: ({ event }: MachineActionParams) =>
		event.type === 'UPDATE_FOOD' ? event.food : 20
})

const updateEntities = assign({
	entities: ({ event }: MachineActionParams) =>
		event.type === 'UPDATE_ENTITIES' ? event.entities : [],
	enemies: ({ event }: MachineActionParams) =>
		event.type === 'UPDATE_ENTITIES' ? event.enemies : [],
	players: ({ event }: MachineActionParams) =>
		event.type === 'UPDATE_ENTITIES' ? event.players : [],
	nearestEnemy: ({ event }: MachineActionParams) =>
		event.type === 'UPDATE_ENTITIES'
			? event.nearestEnemy
			: { entity: null, distance: Infinity }
})

const removeEntity = assign(({ context, event }: MachineActionParams) => {
	if (event.type !== 'REMOVE_ENTITY') return {}

	const { entity } = event
	const isEnemy = entity.type === 'hostile'

	if (isEnemy) {
		return {
			enemies: context.enemies.filter(mob => mob.id !== entity.id)
		}
	}

	return {
		entities: context.entities.filter(mob => mob.id !== entity.id)
	}
})

export default {
	updateHealth,
	updateFood,
	updateEntities,
	removeEntity
}
