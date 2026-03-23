import { assign } from 'xstate'

import type { MachineActionParams } from '@hsm/types'

const updatePosition = assign({
	position: ({ event }: MachineActionParams) => {
		if (event.type !== 'UPDATE_POSITION') return null
		return event.position
	}
})

const updateFoodSaturation = assign({
	foodSaturation: ({ event }: MachineActionParams) => {
		if (event.type !== 'UPDATE_SATURATION') return 0
		return event.foodSaturation
	}
})

const updateAfterDeath = assign({
	entities: [],
	enemies: [],

	// Инвентарь и экипировка
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
	nearestEnemy: {
		entity: null,
		distance: Infinity
	}
})

export default {
	updatePosition,
	updateFoodSaturation,
	updateAfterDeath
}
