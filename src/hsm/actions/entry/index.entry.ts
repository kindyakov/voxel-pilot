import combatEntry from './combat.entry'
import craftingEntry from './crafting.entry'
import farmingEntry from './farming.entry'
import followingEntry from './following.entry'
import miningEntry from './mining.entry'
import monitoringEntry from './monitoring.entry'
import sleepingEntry from './sleeping.entry'
import smeltingEntry from './smelting.entry'
import tasksEntry from './tasks.entry'
import urgentNeedsEntry from './urgentNeeds.entry'

export default {
	...monitoringEntry,
	...combatEntry,
	...miningEntry,
	...urgentNeedsEntry,
	...tasksEntry,
	...followingEntry,
	...smeltingEntry,
	...craftingEntry,
	...sleepingEntry,
	...farmingEntry
}
