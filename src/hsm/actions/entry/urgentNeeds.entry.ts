import type { MachineActionParams } from '@hsm/types'

const entryEmergencyEating = ({ context, event }: MachineActionParams) => {
	console.log('🚨 Вход в EMERGENCY_EATING 🥩')
}

const entryEmergencyHealing = ({ context, event }: MachineActionParams) => {
	console.log('🚨 Вход в EMERGENCY_HEALING 💗')
}

export default {
	entryEmergencyEating,
	entryEmergencyHealing
}
