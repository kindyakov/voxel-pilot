import type { MachineActionParams } from '@hsm/types'

const entrySearchFood = ({ context, event }: MachineActionParams) => {
	console.log('Ищу еду...')
}

export default {
	entrySearchFood
}
