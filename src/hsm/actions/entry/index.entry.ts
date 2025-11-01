import monitoringEntry from './monitoring.entry'
import combatEntry from './combat.entry'
import miningEntry from './mining.entry'
import urgentNeedsEntry from './urgentNeeds.entry'
import tasksEntry from './tasks.entry'

export default {
	...monitoringEntry,
	...combatEntry,
	...miningEntry,
	...urgentNeedsEntry,
	...tasksEntry
}
