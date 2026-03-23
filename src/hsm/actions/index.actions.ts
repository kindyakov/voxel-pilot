import alwaysActions from './always/index.always'
import entryActions from './entry/index.entry'
import exitActions from './exit/index.exit'
import saveActions from './save/index.save'
import updateActions from './update/index.update'

export const actions = {
	...entryActions,
	...exitActions,
	...saveActions,
	...updateActions,
	...alwaysActions
}
