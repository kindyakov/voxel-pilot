import type { MachineActionParams } from '@hsm/types'

const entryMining = ({ context, event }: MachineActionParams) => {
	console.log('Вход в состояние MINING')
}

const taskCompleted = ({ context }: MachineActionParams) => {
	console.log('✅ Task MINING completed!')
	context.taskData = null
}

export default {
	entryMining,
	taskCompleted
}
