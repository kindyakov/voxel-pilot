import type { MachineActionParams } from '@hsm/types'

const exitCombat = ({ context }: MachineActionParams) => {
	console.log('⚔️ Выход из COMBAT')
	if (context.bot) {
		context.bot.movements.canDig = true
	}
}

const exitDeciding = () => {
	console.log('🤔⚔️ Выход из состояния DECIDING')
}

const exitFleeing = ({ context }: MachineActionParams) => {
	context.bot?.pathfinder.setGoal(null)
	console.log('🏃 Выход из состояния FLEEING')
}

const exitMeleeAttack = ({ context }: MachineActionParams) => {
	console.log('🆑 Очистка боя')
	context.bot?.pvp.stop()
	context.bot?.pathfinder.setGoal(null)
	console.log('⚔️ Выход из состояния MELEE_ATTACKING')
}

const exitRangedAttacking = ({ context }: MachineActionParams) => {
	context.bot?.hawkEye.stop()
	context.bot?.pathfinder.setGoal(null)
	console.log('🏹 Выход из состояния RANGED_ATTACKING')
}

const exitDefending = () => {
	console.log('🤔⚔️ Выход из состояния DEFENDING')
}

export default {
	exitCombat,
	exitDeciding,
	exitFleeing,
	exitMeleeAttack,
	exitRangedAttacking,
	exitDefending
}
