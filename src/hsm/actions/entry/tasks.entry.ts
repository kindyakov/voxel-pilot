import type { MachineActionParams } from '@hsm/types'

const entryMining = ({ context, event }: MachineActionParams) => {
	console.log('Вход в состояние MINING')
}

export default {
	entryMining
}
