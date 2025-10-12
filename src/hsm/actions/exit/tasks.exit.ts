import type { MachineActionParams } from '@hsm/types'

const exitMining = ({ context, event }: MachineActionParams) => {
	console.log('Выход из состояния MINING')
}

export default {
	exitMining
}
