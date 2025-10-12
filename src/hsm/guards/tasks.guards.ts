import { and, stateIn } from 'xstate'
import type { MachineGuardParams } from '@hsm/types'

const noTasks = and([
	stateIn({ MAIN_ACTIVITY: 'TASKS' }),
	({ context }: MachineGuardParams): boolean => !context.taskData
])

const hasRequiredTool = and([
	({ context }: MachineGuardParams): boolean => context.taskData?.requiredTool
])

export default {
	noTasks
}
