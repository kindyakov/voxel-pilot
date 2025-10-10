import combatActors from './combat.actors.js'
import monitoringActors from './monitoring.actors'
import urgentNeedsActors from './urgentNeeds.actors'
import primitivesActors from './primitives/index.primitive.js'

export const actors = {
	...combatActors,
	...monitoringActors,
	...urgentNeedsActors,
	...primitivesActors
}
