import { and, stateIn } from 'xstate'
import type { MachineContext } from '../context'
import type { MachineEvent } from '../types'

const noTasks = and([
	stateIn({ MAIN_ACTIVITY: 'TASKS' }),
	({ context }: { context: MachineContext; event: MachineEvent }): boolean =>
		!context.taskData
])

export default {
	noTasks
}
