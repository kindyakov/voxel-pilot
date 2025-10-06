import type { ActionParams } from '../../types'

const exitMining = ({}: ActionParams) => {}
const exitFarming = ({}: ActionParams) => {}
const exitBuilding = ({}: ActionParams) => {}
const exitSleeping = ({}: ActionParams) => {}
const exitFollowing = ({}: ActionParams) => {}
const exitSheltering = ({}: ActionParams) => {}

export default {
	exitBuilding,
	exitFarming,
	exitFollowing,
	exitMining,
	exitSleeping,
	exitSheltering
}
