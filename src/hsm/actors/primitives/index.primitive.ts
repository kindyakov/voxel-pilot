import { primitiveSearchBlock } from './primitiveSearchBlock.primitive'
import { primitiveNavigating } from './primitiveNavigating.primitive'
import { primitiveSearchEntity } from './primitiveSearchEntity.primitive'
import { primitiveBreaking } from './primitiveBreaking.primitive'
import { primitiveOpenContainer } from './primitiveOpenContainer.primitive'

export type PrimitiveType =
	| 'primitiveSearchBlock'
	| 'primitiveNavigating'
	| 'primitiveSearchEntity'
	| 'primitiveBreaking'
	| 'primitiveOpenContainer'

export default {
	primitiveSearchBlock,
	primitiveNavigating,
	primitiveSearchEntity,
	primitiveBreaking,
	primitiveOpenContainer
}
