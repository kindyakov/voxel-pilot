import monitoringEntry from './monitoring.entry'
import combatEntry from './combat.entry'
import tasksEntry from './tasks.entry'
import urgentNeedsEntry from './urgentNeeds.entry'

export default {
	...monitoringEntry,
	...combatEntry,
	...tasksEntry,
	...urgentNeedsEntry
}
