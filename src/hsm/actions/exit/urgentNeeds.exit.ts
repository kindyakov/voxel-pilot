import type { ActionParams } from '../../types'

const exitEmergencyEating = ({ context }: ActionParams): void => {
	console.log('✅ Выход из EMERGENCY_EATING 🥩')
	context.bot?.pathfinder.setGoal(null)
	context.bot?.utils.stopEating()
}

const exitEmergencyHealing = ({ context }: ActionParams): void => {
	console.log('✅ Выход из EMERGENCY_HEALING 💗')
	context.bot?.pathfinder.setGoal(null)
	context.bot?.utils.stopEating()
}

export default {
	exitEmergencyEating,
	exitEmergencyHealing
}
