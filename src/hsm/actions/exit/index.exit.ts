import combatExit from './combat.exit'
import urgentNeedsExit from './urgentNeeds.exit'
import miningExit from './mining.exit'

export default {
	...combatExit,
	...urgentNeedsExit,
	...miningExit
}
