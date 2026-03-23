import combatExit from './combat.exit'
import craftingExit from './crafting.exit'
import farmingExit from './farming.exit'
import followingExit from './following.exit'
import miningExit from './mining.exit'
import sleepingExit from './sleeping.exit'
import smeltingExit from './smelting.exit'
import tasksExit from './tasks.exit'
import urgentNeedsExit from './urgentNeeds.exit'

export default {
	...combatExit,
	...urgentNeedsExit,
	...miningExit,
	...tasksExit,
	...followingExit,
	...smeltingExit,
	...craftingExit,
	...sleepingExit,
	...farmingExit
}
