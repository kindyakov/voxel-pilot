import type { MachineActionParams } from '@hsm/types'

const saveMiningProgress = ({ context, event }: MachineActionParams) => {}
const saveBuildingProgress = ({ context, event }: MachineActionParams) => {}
const saveFarmingProgress = ({ context, event }: MachineActionParams) => {}

export default {
	saveMiningProgress,
	saveBuildingProgress,
	saveFarmingProgress
}
