import { assign } from 'xstate'
import type { MachineActionParams } from '@hsm/types'
import { findNearbyEnemies } from '@hsm/utils/findNearbyEnemies'

const setTargetOnEnemy = assign(({ context }: MachineActionParams) => {
	const nearestEnemy = findNearbyEnemies(context)

	if (!nearestEnemy || !context.position) {
		return {
			nearestEnemy: {
				entity: null,
				distance: Infinity
			}
		}
	}

	const distance = nearestEnemy.position.distanceTo(context.position)

	return {
		nearestEnemy: {
			entity: nearestEnemy,
			distance
		}
	}
})

export default {
	setTargetOnEnemy
}
