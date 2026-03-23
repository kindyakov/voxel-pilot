import {
	type BaseServiceState,
	createStatefulService
} from '@/hsm/helpers/createStatefulService'

import type { Block, Entity, Vec3 } from '@types'

import { GoalNear } from '@modules/plugins/goals'

interface NavigatingState extends BaseServiceState {
	targetPosition: Vec3 | null
}

interface NavigatingParams {
	target: Vec3 | Entity | Block
	range?: number
}

export const primitiveNavigating = createStatefulService<
	NavigatingState,
	NavigatingParams
>({
	name: 'PrimitiveNavigating',
	initialState: {
		targetPosition: null
	},
	onStart: ({ input, sendBack, bot }) => {
		const { target, range = 1 } = input

		if (!target) {
			sendBack({ type: 'NAVIGATION_FAILED' })
			return
		}
		const { x, y, z } = (target as Entity | Block).position ?? (target as Vec3)
		console.log('🏃 primitiveNavigating to:', x, y, z)
		bot.pathfinder.setGoal(new GoalNear(x, y, z, range))
	},

	onEvents: () => ({
		goal_reached: ({ sendBack }, params) => {
			console.log('✅ primitiveNavigating goal_reached to:', params)
			sendBack({ type: 'ARRIVED' })
		},
		path_stop: ({ sendBack }, params) => {
			console.log('❌ primitiveNavigating path_stop:', params)
			sendBack({ type: 'NAVIGATION_FAILED' })
		}
	}),

	onCleanup: ({ bot }) => {
		console.log('🧹 [primitiveNavigating] Cleanup')
		try {
			bot.pathfinder.setGoal(null)
			console.log('🛑 [primitiveNavigating] Pathfinder остановлен')
		} catch (error) {
			console.error('❌ [primitiveNavigating] Ошибка при остановке:', error)
		}
	}
})
