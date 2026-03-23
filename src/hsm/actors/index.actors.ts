import combatActors from './combat.actors.js'
import monitoringActors from './monitoring.actors'
import primitivesActors from './primitives/index.primitive.js'
import urgentNeedsActors from './urgentNeeds.actors'

export const actors = {
	...combatActors,
	...monitoringActors,
	...urgentNeedsActors,
	...primitivesActors
}
