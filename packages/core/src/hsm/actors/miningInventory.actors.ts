import type { RuntimeLogger } from '@/config/runtimeLogger.js'

import { createStatefulService } from '@/hsm/helpers/createStatefulService.js'
import { currentTarget, getMiningTask } from '@/hsm/tasks/task.js'

export const createMiningInventory = (logger: RuntimeLogger) => {
	/** Scoped to MINING: pause/stop removes the sampler along with the execution. */
	const miningInventory = createStatefulService({
		logger,
		name: 'miningInventory',
		tickInterval: 50,
		onTick: ({ sendBack }) => sendBack({ type: 'MINING_INVENTORY_CHANGED' }),
		onEvents: () => ({
			physicsTick: ({ sendBack }) =>
				sendBack({ type: 'MINING_INVENTORY_CHANGED' }),
			blockUpdate: ({ bot, context, sendBack }) => {
				const task = getMiningTask(context.taskData)
				const target = task && currentTarget(task)
				if (target && bot.blockAt(target.position)?.name !== target.name)
					sendBack({ type: 'MINING_ROUTE_TARGET_CHANGED' })
			}
		})
	})

	return miningInventory
}
