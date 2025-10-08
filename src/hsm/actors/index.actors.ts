import combatActors from './combat.actors.js'
import monitoringActors from './monitoring.actors.js'
import urgentNeedsActors from './urgentNeeds.actors.js'

export const actors = {
  ...combatActors,
  ...monitoringActors,
  ...urgentNeedsActors
}