import combatExit from './combat.exit'
import pefcefulExit from './pefceful.exit'
import urgentNeedsExit from './urgentNeeds.exit'

export default {
	...combatExit,
	...pefcefulExit,
	...urgentNeedsExit
}
