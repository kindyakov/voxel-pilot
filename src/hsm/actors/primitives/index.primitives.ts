import { primitiveSearchBlock } from './primitiveSearchBlock.primitives'
import { primitiveNavigating } from './primitiveNavigating.primitives'
import { primitiveSearchEntity } from './primitiveSearchEntity.primitives'

export type PrimitiveType =
	| 'primitiveSearchBlock'
	| 'primitiveNavigating'
	| 'primitiveSearchEntity'

export default {
	primitiveSearchBlock,
	primitiveNavigating,
	primitiveSearchEntity
}
