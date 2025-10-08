import type { MachineActionParams } from '@hsm/types'

const entryIdle = ({ context, event }: MachineActionParams) => {
	console.log('🥱 Вход в состояние IDLE')
}

const entryMining = ({ context, event }: MachineActionParams) => {
	console.log('⛏️ Вход в состояние MINING')
}

const entryFarming = ({ context, event }: MachineActionParams) => {
	console.log('⚒️ Вход в состояние FARMING')
}

const entryBuilding = ({ context, event }: MachineActionParams) => {
	console.log('🧱 Вход в состояние BUILDING')
}

const entrySleeping = ({ context, event }: MachineActionParams) => {
	console.log('🛏️ Вход в состояние SLEEPING')
}

const entryFollowing = ({ context, event }: MachineActionParams) => {
	console.log('🚶‍♂️‍➡️ Вход в состояние FOLLOWING')
}

const entrySheltering = ({ context, event }: MachineActionParams) => {
	console.log('🏠 Вход в состояние SHELTERING')
}

export default {
	entryIdle,
	entryMining,
	entryFarming,
	entryBuilding,
	entrySleeping,
	entryFollowing,
	entrySheltering
}
