import type { Block, Entity, Vec3 } from '@/types/index.js'

import type { RuntimeLogger } from '@/config/runtimeLogger.js'

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

export const createPrimitiveNavigating = (logger: RuntimeLogger) => {
	const primitiveNavigating = createStatefulService<
		NavigatingState,
		NavigatingParams
	>({
		logger,
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
			const { x, y, z } =
				(target as Entity | Block).position ?? (target as Vec3)
			logger.debug('🏃 primitiveNavigating to', { x, y, z })
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
				logger.debug('✅ primitiveNavigating goal_reached', { params })
				sendBack({ type: 'ARRIVED' })
			},
			path_stop: ({ sendBack }, params) => {
				logger.warn('❌ primitiveNavigating path_stop', { params })
				sendBack({ type: 'NAVIGATION_FAILED' })
			}
		}),

		onCleanup: ({ bot }) => {
			logger.debug('🧹 [primitiveNavigating] Cleanup')
			try {
				bot.pathfinder.setGoal(null)
				logger.debug('🛑 [primitiveNavigating] Pathfinder остановлен')
			} catch (error) {
				logger.error('❌ [primitiveNavigating] Ошибка при остановке', {
					error: error instanceof Error ? error.message : String(error),
					stack: error instanceof Error ? error.stack : undefined
				})
			}
		}
	})

	return primitiveNavigating
}
