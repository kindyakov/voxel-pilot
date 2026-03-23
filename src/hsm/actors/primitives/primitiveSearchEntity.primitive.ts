import {
	type BaseServiceState,
	createStatefulService
} from '@/hsm/helpers/createStatefulService'
import type { Entity } from '@/types'

interface SearchEntityState extends BaseServiceState {
	entityType?: string
	entityName?: string
	maxDistance: number
	maxSearchTicks: number
	tickCount: number
	searching: boolean
	foundEntity?: Entity | null
}

interface SearchEntityOptions {
	entityType?: string | undefined // Тип сущности: 'hostile', 'player', 'animal', 'mob'
	entityName?: string | undefined // Конкретное имя сущности: 'zombie', 'skeleton', 'cow' и т.д.
	maxDistance?: number | undefined
	maxSearchTicks?: number | undefined // Максимальное количество тиков до NOT_FOUND (по умолчанию 20)
}

const optDefault = {
	maxDistance: 32,
	maxSearchTicks: 20
}

export const primitiveSearchEntity = createStatefulService<
	SearchEntityState,
	SearchEntityOptions
>({
	name: 'primitiveSearchEntity',
	tickInterval: 500,
	initialState: {
		maxDistance: optDefault.maxDistance,
		maxSearchTicks: optDefault.maxSearchTicks,
		tickCount: 0,
		searching: false,
		foundEntity: null
	},

	onStart: api => {
		const {
			entityType,
			entityName,
			maxDistance = optDefault.maxDistance,
			maxSearchTicks = optDefault.maxSearchTicks
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
			maxSearchTicks,
			tickCount: 0,
			searching: true
		})

		console.log(
			`🔍 [primitiveSearchEntity] Ищу ${entityName || entityType} в радиусе ${maxDistance}m (таймаут: ${maxSearchTicks} тиков)`
		)
	},

	onTick: api => {
		const {
			entityType,
			entityName,
			maxDistance,
			maxSearchTicks,
			tickCount,
			searching
		} = api.state

		if (!searching) return

		// Инкрементируем счетчик тиков
		api.setState({ tickCount: tickCount + 1 })

		const botPos = api.bot.entity.position

		// Объединяем все сущности в один массив
		const searchPool = Object.values(api.bot.entities)

		// Фильтруем по имени, типу и расстоянию
		const candidates = searchPool
			.filter(entity => {
				// 1. Сначала всегда проверяем расстояние (чтобы не байпасить радиус)
				const distance = botPos.distanceTo(entity.position)
				if (distance > maxDistance) return false

				// 2. Фильтр по имени (если указано точное совпадение)
				if (entityName) {
					// Имя игрока или имя сущности
					return entity.username === entityName || entity.name === entityName
				}

				// 3. Фильтр по типу (если указан)
				if (entityType) {
					if (entityType === 'hostile') {
						// Простая проверка врагов по типу (в mineflayer type 'mob' и hostile name)
						const hostileNames = [
							'zombie',
							'skeleton',
							'creeper',
							'spider',
							'enderman',
							'witch',
							'slime'
						]
						return hostileNames.includes(entity.name!)
					} else if (entityType === 'player') {
						return entity.type === 'player'
					} else {
						return entity.type === entityType
					}
				}

				return true
			})
			.sort((a, b) => {
				// Сортируем по расстоянию (ближайший первый)
				const distA = botPos.distanceTo(a.position)
				const distB = botPos.distanceTo(b.position)
				return distA - distB
			})

		if (candidates.length === 0) {
			// Проверяем таймаут
			if (tickCount >= maxSearchTicks) {
				console.warn(
					`⏰ [primitiveSearchEntity] Таймаут поиска ${entityName || entityType} после ${tickCount} тиков`
				)
				api.setState({ searching: false })
				api.sendBack({
					type: 'NOT_FOUND',
					reason: `Таймаут поиска: ${entityName || entityType} не найден за ${tickCount} тиков`
				})
			}
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
		setState({ searching: false, foundEntity: null, tickCount: 0 })
	}
})
