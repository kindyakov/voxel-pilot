import {
	createStatefulService,
	type BaseServiceState
} from '@/hsm/helpers/createStatefulService'

interface NavigatingState extends BaseServiceState {}

export const primitiveNavigating = createStatefulService<NavigatingState>({
	name: 'PrimitiveNavigating',
	initialState: {}
})
