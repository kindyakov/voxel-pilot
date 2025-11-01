import combatExit from './combat.exit'
import urgentNeedsExit from './urgentNeeds.exit'
import miningExit from './mining.exit'
import tasksExit from './tasks.exit'

export default {
	...combatExit,
	...urgentNeedsExit,
	...miningExit,
	...tasksExit
}
