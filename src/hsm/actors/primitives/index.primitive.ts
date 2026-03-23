import { primitiveBreaking } from './primitiveBreaking.primitive'
import { primitiveCraft } from './primitiveCraft.primitive'
import { primitiveCraftInWorkbench } from './primitiveCraftInWorkbench.primitive'
import { primitiveFollowing } from './primitiveFollowing.primitive'
import { primitiveNavigating } from './primitiveNavigating.primitive'
import { primitiveOpenContainer } from './primitiveOpenContainer.primitive'
import { primitivePlacing } from './primitivePlacing.primitive'
import { primitiveSearchBlock } from './primitiveSearchBlock.primitive'
import { primitiveSearchEntity } from './primitiveSearchEntity.primitive'
import { primitiveSmelt } from './primitiveSmelt.primitive'

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
	| 'primitiveFollowing'

export default {
	primitiveSearchBlock,
	primitiveNavigating,
	primitiveSearchEntity,
	primitiveBreaking,
	primitiveOpenContainer,
	primitiveCraft,
	primitiveCraftInWorkbench,
	primitiveSmelt,
	primitivePlacing,
	primitiveFollowing
}
