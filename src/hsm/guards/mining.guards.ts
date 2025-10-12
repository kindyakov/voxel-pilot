import type { MachineContext } from '@hsm/context'
import type { MiningTaskData } from '@hsm/tasks/index'

const isBlockNearby = ({ context }: { context: MachineContext }) => {
	if (!context.position || !context.taskData) return false
	const taskData = context.taskData as MiningTaskData
	return taskData.targetBlock?.position.distanceTo(context.position)! <= 4
}

export default {
	isBlockNearby
}
