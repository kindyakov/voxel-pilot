import { primitiveSearchBlock } from './primitiveSearchBlock.primitive'
import { primitiveNavigating } from './primitiveNavigating.primitive'
import { primitiveSearchEntity } from './primitiveSearchEntity.primitive'
import { primitiveBreaking } from './primitiveBreaking.primitive'
import { primitiveOpenContainer } from './primitiveOpenContainer.primitive'
import { primitiveCraft } from './primitiveCraft.primitive'
import { primitiveCraftInWorkbench } from './primitiveCraftInWorkbench.primitive'
import { primitiveSmelt } from './primitiveSmelt.primitive'
import { primitivePlacing } from './primitivePlacing.primitive'

export type PrimitiveType =
	| 'primitiveSearchBlock'
	| 'primitiveNavigating'
	| 'primitiveSearchEntity'
	| 'primitiveBreaking'
	| 'primitiveOpenContainer'
	| 'primitiveCraft'
	| 'primitiveCraftInWorkbench'
	| 'primitiveSmelt'
	| 'primitivePlacing'

export default {
	primitiveSearchBlock,
	primitiveNavigating,
	primitiveSearchEntity,
	primitiveBreaking,
	primitiveOpenContainer,
	primitiveCraft,
	primitiveCraftInWorkbench,
	primitiveSmelt,
	primitivePlacing
}
