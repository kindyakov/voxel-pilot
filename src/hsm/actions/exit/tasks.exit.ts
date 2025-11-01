import { MachineActionParams } from '@/hsm/types'

const exitTasks = ({ context }: MachineActionParams) => {
	context.isActiveTask = false
}

export default {
	exitTasks
}
