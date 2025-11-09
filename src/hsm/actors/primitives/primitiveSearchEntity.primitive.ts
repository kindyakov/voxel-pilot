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
	entityType?: string | undefined // Тип сущности: 'hostile', 'player', 'animal', 'mob'
	entityName?: string | undefined // Конкретное имя сущности: 'zombie', 'skeleton', 'cow' и т.д.
	maxDistance?: number | undefined
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
				'[primitiveSearchEntity] ❌ Отсутсвует entityType и entityName'
			)
			api.sendBack({
				type: 'NOT_FOUND',
				reason: 'Отсутствуют обязательные параметры: entityType и entityName'
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

		// Получаем уже отфильтрованные сущности из контекста
		const { entities, enemies, players } = api.context

		// Объединяем все сущности в один массив в зависимости от фильтров
		let searchPool: Entity[] = []

		if (entityType) {
			// Если указан тип - выбираем из соответствующего массива
			if (entityType === 'hostile') {
				searchPool = enemies
			} else if (entityType === 'player') {
				searchPool = players
			} else {
				// Для других типов (animal, mob и т.д.) используем entities
				searchPool = entities.filter(e => e.type === entityType)
			}
		} else {
			// Если тип не указан - ищем по всем категориям
			searchPool = [...entities, ...enemies, ...players]
		}

		// Фильтруем по имени и расстоянию
		const candidates = searchPool
			.filter(entity => {
				// Если это имя игрока фильтруем без дистанции
				if (entity.username === entityName) return true
				// Фильтр по имени (если указан)
				if (entityName && entity.name !== entityName) return false

				// Проверяем расстояние
				const distance = botPos.distanceTo(entity.position)
				if (distance > maxDistance) return false

				return true
			})
			.sort((a, b) => {
				// Сортируем по расстоянию (ближайший первый)
				const distA = botPos.distanceTo(a.position)
				const distB = botPos.distanceTo(b.position)
				return distA - distB
			})

		if (candidates.length === 0) {
			return
		}

		// Берём ближайшую сущность
		const foundEntity = candidates[0]
		const distance = botPos.distanceTo(foundEntity!.position)

		console.log(
			`✅ [primitiveSearchEntity] Найдена сущность ${foundEntity!.name || foundEntity!.type} ` +
				`на расстоянии ${distance.toFixed(1)}m в позиции ${foundEntity!.position}`
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
