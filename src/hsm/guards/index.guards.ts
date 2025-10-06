import monitoringGuards from './monitoring.guards'
import urgentNeedsGuards from './urgentNeeds.guards'
import combatGuards from './combat.guards'
import tasksGuards from './tasks.guards'
import peacefulGuards from './peaceful.guards'

export const guards = {
	...monitoringGuards,
	...urgentNeedsGuards,
	...combatGuards,
	...tasksGuards,
	...peacefulGuards
}
