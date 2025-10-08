import type { MachineActionParams } from '@hsm/types'

const exitEmergencyEating = ({ context }: MachineActionParams): void => {
	console.log('✅ Выход из EMERGENCY_EATING 🥩')
	context.bot?.pathfinder.setGoal(null)
	context.bot?.utils.stopEating()
}

const exitEmergencyHealing = ({ context }: MachineActionParams): void => {
	console.log('✅ Выход из EMERGENCY_HEALING 💗')
	context.bot?.pathfinder.setGoal(null)
	context.bot?.utils.stopEating()
}

export default {
	exitEmergencyEating,
	exitEmergencyHealing
}
