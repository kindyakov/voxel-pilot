import type { MachineActionParams } from '@hsm/types'

const exitMining = ({}: MachineActionParams) => {}
const exitFarming = ({}: MachineActionParams) => {}
const exitBuilding = ({}: MachineActionParams) => {}
const exitSleeping = ({}: MachineActionParams) => {}
const exitFollowing = ({}: MachineActionParams) => {}
const exitSheltering = ({}: MachineActionParams) => {}

export default {
	exitBuilding,
	exitFarming,
	exitFollowing,
	exitMining,
	exitSleeping,
	exitSheltering
}
