import { MachineActionParams } from '@/hsm/types'

const entryTasks = ({ context }: MachineActionParams) => {
	context.isActiveTask = true
}

export default {
	entryTasks
}
