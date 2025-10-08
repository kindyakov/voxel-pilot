import type { MachineActionParams } from '@hsm/types'

const entryCombat = ({ context }: MachineActionParams) => {
	console.log('⚔️ Вход в состояние COMBAT')

	context.bot?.armorManager.equipAll() // Бот при наличии брони в инвенторе наденет её
}

const entryDeciding = ({ context }: MachineActionParams) => {
	console.log('🤔⚔️ Вход в состояние DECIDING')
}

const entryFleeing = ({ context, event }: MachineActionParams) => {
	console.log('🏃 Вход в состояние FLEEING')
}

const entryDefenging = ({ context, event }: MachineActionParams) => {
	console.log('⚔️ Вход в состояние DEFENDING')
}

const entryMeleeAttacking = ({ context, event }: MachineActionParams) => {
	console.log('⚔️ Вход в состояние MELEE_ATTACKING')
}

const entryRangedAttacking = ({ context, event }: MachineActionParams) => {
	console.log('⚔️ Вход в состояние RANGED_ATTACKING')
}

export default {
	entryCombat,
	entryDeciding,
	entryFleeing,
	entryDefenging,
	entryMeleeAttacking,
	entryRangedAttacking
}
