import type { ActionParams } from '../../types'

const exitCombat = ({ context }: ActionParams) => {
	console.log('⚔️ Выход из COMBAT')
}

const exitDeciding = () => {
	console.log('🤔⚔️ Выход из состояния DECIDING')
}

const exitFleeing = ({ context }: ActionParams) => {
	context.bot?.pathfinder.setGoal(null)
	console.log('🏃 Выход из состояния FLEEING')
}

const exitMeleeAttack = ({ context }: ActionParams) => {
	console.log('🆑 Очистка боя')
	context.bot?.pvp.stop()
	context.bot?.pathfinder.setGoal(null)
	console.log('⚔️ Выход из состояния MELEE_ATTACKING')
}

const exitRangedAttacking = ({ context }: ActionParams) => {
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
