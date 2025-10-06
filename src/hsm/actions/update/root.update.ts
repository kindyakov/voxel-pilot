import { assign } from 'xstate'
import type { ActionParams } from '../../types'

const setBot = assign({
	bot: ({ context, event }: ActionParams) => event.bot
})

const updatePosition = assign({
	position: ({ context, event }: ActionParams) => event.position
})

const updateFoodSaturation = assign({
	foodSaturation: ({ context, event }: ActionParams) => event.foodSaturation
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
	setBot,
	updatePosition,
	updateFoodSaturation,
	updateAfterDeath
}
