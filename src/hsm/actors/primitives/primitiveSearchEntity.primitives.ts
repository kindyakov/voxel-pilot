import {
	createStatefulService,
	type BaseServiceState
} from '@/hsm/helpers/createStatefulService'

interface SearchEntityState extends BaseServiceState {}

export const primitiveSearchEntity = createStatefulService<SearchEntityState>({
	name: 'PrimitiveNavigating',
	initialState: {}
})
