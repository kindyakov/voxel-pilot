import combatExit from './combat.exit'
import urgentNeedsExit from './urgentNeeds.exit'
import miningExit from './mining.exit'
import tasksExit from './tasks.exit'
import followingExit from './following.exit'
import smeltingExit from './smelting.exit'
import craftingExit from './crafting.exit'
import sleepingExit from './sleeping.exit'
import farmingExit from './farming.exit'

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
