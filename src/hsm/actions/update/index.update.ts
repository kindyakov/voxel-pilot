import rootUpdate from './root.update'
import monitoringUpdate from './monitoring.update'
import combatUpdate from './combat.update'

export default {
	...rootUpdate,
	...monitoringUpdate,
	...combatUpdate
}
