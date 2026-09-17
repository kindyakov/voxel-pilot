import type { Block, Entity, Vec3 } from '@/types/index.js'

import Logger from '@/config/logger.js'

import {
	type BaseServiceState,
	createStatefulService
} from '@/hsm/helpers/createStatefulService.js'

import { GoalNear } from '@/modules/plugins/goals.js'

interface NavigatingState extends BaseServiceState {
	targetPosition: Vec3 | null
}

interface NavigatingParams {
	target: Vec3 | Entity | Block | null
	range?: number
}

export const primitiveNavigating = createStatefulService<
	NavigatingState,
	NavigatingParams
>({
	name: 'PrimitiveNavigating',
	timeoutMs: 30_000,
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
		Logger.debug('🏃 primitiveNavigating to', { x, y, z })
		bot.pathfinder.setGoal(new GoalNear(x, y, z, range))
	},

	onEvents: () => ({
		path_update: ({ sendBack }, result: { status: string }) => {
			if (result.status === 'noPath' || result.status === 'timeout') {
				sendBack({
					type: 'NAVIGATION_FAILED',
					reason: `Pathfinder ${result.status}`
				})
			}
		},
		goal_reached: ({ sendBack }, params) => {
			Logger.debug('✅ primitiveNavigating goal_reached', { params })
			sendBack({ type: 'ARRIVED' })
		},
		path_stop: ({ sendBack }, params) => {
			Logger.warn('❌ primitiveNavigating path_stop', { params })
			sendBack({ type: 'NAVIGATION_FAILED' })
		}
	}),

	onCleanup: ({ bot }) => {
		Logger.debug('🧹 [primitiveNavigating] Cleanup')
		try {
			bot.pathfinder.setGoal(null)
			Logger.debug('🛑 [primitiveNavigating] Pathfinder остановлен')
		} catch (error) {
			Logger.error('❌ [primitiveNavigating] Ошибка при остановке', {
				error: error instanceof Error ? error.message : String(error),
				stack: error instanceof Error ? error.stack : undefined
			})
		}
	}
})
