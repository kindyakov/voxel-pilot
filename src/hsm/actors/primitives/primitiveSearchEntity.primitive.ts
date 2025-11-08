import type { Entity } from '@/types'
import {
	createStatefulService,
	type BaseServiceState
} from '@/hsm/helpers/createStatefulService'

interface SearchEntityState extends BaseServiceState {
	entityType?: string
	entityName?: string
	maxDistance: number
	searching: boolean
	foundEntity?: Entity | null
}

interface SearchEntityOptions {
	entityType?: string // Тип сущности: 'hostile', 'player', 'animal', 'mob'
	entityName?: string // Конкретное имя сущности: 'zombie', 'skeleton', 'cow' и т.д.
	maxDistance?: number
}

const optDefault = {
	maxDistance: 32
}

export const primitiveSearchEntity = createStatefulService<
	SearchEntityState,
	SearchEntityOptions
>({
	name: 'primitiveSearchEntity',
	tickInterval: 500,
	initialState: {
		maxDistance: optDefault.maxDistance,
		searching: false,
		foundEntity: null
	},

	onStart: api => {
		const {
			entityType,
			entityName,
			maxDistance = optDefault.maxDistance
		} = api.input

		if (!entityType && !entityName) {
			console.error(
				'[primitiveSearchEntity] ❌ Missing entityType or entityName'
			)
			api.sendBack({
				type: 'NOT_FOUND',
				reason: 'Missing required parameter: entityType or entityName'
			})
			return
		}

		api.setState({
			entityType,
			entityName,
			maxDistance,
			searching: true
		})

		console.log(
			`🔍 [primitiveSearchEntity] Ищу ${entityName || entityType} в радиусе ${maxDistance}m`
		)
	},

	onTick: api => {
		const { entityType, entityName, maxDistance, searching } = api.state

		if (!searching) return

		const botPos = api.bot.entity.position

		// Создаём фильтр для поиска сущности
		const filter = (entity: Entity): boolean => {
			// Пропускаем самого бота
			if (entity.id === api.bot.entity.id) return false

			// Проверяем расстояние
			const distance = botPos.distanceTo(entity.position)
			if (distance > maxDistance) return false

			// Фильтр по имени (если указан)
			if (entityName && entity.name !== entityName) return false

			// Фильтр по типу (если указан)
			if (entityType && entity.type !== entityType) return false

			return true
		}

		// Ищем ближайшую подходящую сущность
		const foundEntity = api.bot.nearestEntity(filter)

		if (!foundEntity) {
			return
		}

		const distance = botPos.distanceTo(foundEntity.position)

		console.log(
			`✅ [primitiveSearchEntity] Найдена сущность ${foundEntity.name || foundEntity.type} ` +
				`на расстоянии ${distance.toFixed(1)}m в позиции ${foundEntity.position}`
		)

		// Останавливаем поиск
		api.setState({ searching: false, foundEntity })

		// Отправляем результат
		api.sendBack({
			type: 'FOUND',
			entity: foundEntity
		})
	},

	onCleanup: ({ setState }) => {
		console.log(`🧹 [primitiveSearchEntity] Cleanup`)
		setState({ searching: false, foundEntity: null })
	}
})
