import monitoringGuards from './monitoring.guards'
import urgentNeedsGuards from './urgentNeeds.guards'
import combatGuards from './combat.guards'
import miningGuards from './mining.guards'

export const guards = {
	...monitoringGuards,
	...urgentNeedsGuards,
	...combatGuards,
	...miningGuards
}
