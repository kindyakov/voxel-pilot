import type { Entity, Block, Vec3 } from '@types'
import {
	createStatefulService,
	type BaseServiceState
} from '@/hsm/helpers/createStatefulService'

interface FollowingState extends BaseServiceState {
	target: Entity | Vec3 | null
	distance: number
	isFollowing: boolean
}

interface FollowingOptions {
	target: Entity | Block | Vec3 // Цель для следования (сущность, блок или координаты)
	distance?: number // Дистанция следования (по умолчанию 3 блока)
}

export const primitiveFollowing = createStatefulService<
	FollowingState,
	FollowingOptions
>({
	name: 'primitiveFollowing',
	tickInterval: 500,
	initialState: {
		target: null,
		distance: 3,
		isFollowing: false
	},

	onStart: api => {
		const { target, distance = 3 } = api.input

		if (!target) {
			console.error('❌ [primitiveFollowing] Не предоставлена цель')
			api.sendBack({
				type: 'FOLLOWING_FAILED',
				reason: 'Не предоставлена цель'
			})
			return
		}

		// Определяем целевую позицию
		let targetEntity: Entity | null = null
		let targetPos: Vec3

		if ((target as Entity).position) {
			// Это сущность
			targetEntity = target as Entity
			targetPos = (target as Entity).position
		} else if ((target as Block).position) {
			// Это блок
			targetPos = (target as Block).position
		} else {
			// Это Vec3
			targetPos = target as Vec3
		}

		api.setState({
			target: targetEntity || targetPos,
			distance,
			isFollowing: true
		})

		console.log(
			`🏃 [primitiveFollowing] Начинаю следование ${targetEntity ? `за ${targetEntity.name || targetEntity.type}` : `к позиции ${targetPos}`} на дистанции ${distance} блоков`
		)

		// Запускаем следование через movement плагин
		if (targetEntity) {
			// Следуем за сущностью
			api.bot.movement.setGoal({
				entity: targetEntity,
				distance
			})
		} else {
			// Следуем к статичной позиции
			api.bot.movement.setGoal({
				position: targetPos,
				distance
			})
		}
	},

	onTick: api => {
		const { target, distance, isFollowing } = api.state

		if (!isFollowing) return

		// Проверяем, существует ли еще цель (если это сущность)
		if (target && (target as Entity).id) {
			const entity = target as Entity
			const stillExists = api.bot.entities[entity.id]

			if (!stillExists) {
				console.log('⚠️ [primitiveFollowing] Цель исчезла')
				api.bot.movement.clearGoal()
				api.setState({ isFollowing: false })
				api.sendBack({
					type: 'FOLLOWING_STOPPED',
					reason: 'Цель исчезла'
				})
				return
			}

			// Обновляем цель в movement (на случай если она движется)
			api.bot.movement.setGoal({
				entity: entity,
				distance
			})
		}
		// Для статичной позиции (Vec3) просто продолжаем следовать
		// movement сам будет поддерживать дистанцию
	},

	onCleanup: ({ bot, setState }) => {
		console.log('🧹 [primitiveFollowing] Cleanup')

		// Останавливаем следование
		try {
			bot.movement.clearGoal()
			console.log('🛑 [primitiveFollowing] Следование остановлено')
		} catch (error) {
			console.error('❌ [primitiveFollowing] Ошибка при остановке следования:', error)
		}

		setState({ isFollowing: false, target: null })
	}
})
