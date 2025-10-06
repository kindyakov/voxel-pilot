import combatExit from "./combat.exit.js"
import pefcefulExit from "./pefceful.exit.js"
import urgentNeedsExit from "./urgentNeeds.exit.js"

export default {
  ...combatExit,
  ...pefcefulExit,
  ...urgentNeedsExit,
}