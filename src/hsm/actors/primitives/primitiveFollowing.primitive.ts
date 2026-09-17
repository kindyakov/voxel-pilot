import type { Entity } from '@/types/index.js'

import Logger from '@/config/logger.js'

import {
	type BaseServiceState,
	createStatefulService
} from '@/hsm/helpers/createStatefulService.js'

import { GoalFollow } from '@/modules/plugins/goals.js'

interface FollowingState extends BaseServiceState {
	target: Entity | null
	distance: number
	isFollowing: boolean
}

interface FollowingOptions {
	target: Entity | null // Цель для следования (сущность, блок или координаты)
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
			Logger.error('❌ [primitiveFollowing] Не предоставлена цель')
			api.sendBack({
				type: 'FOLLOWING_FAILED',
				reason: 'Не предоставлена цель'
			})
			return
		}

		// Определяем целевую сущность
		let targetEntity: Entity | null = null

		if ((target as Entity).position) {
			// Это сущность
			targetEntity = target as Entity
		} else {
			Logger.error(
				'❌ [primitiveFollowing] GoalFollow работает только с Entity'
			)
			api.sendBack({
				type: 'FOLLOWING_FAILED',
				reason: 'Цель должна быть Entity (не Vec3 или Block)'
			})
			return
		}

		api.setState({
			target: targetEntity,
			distance,
			isFollowing: true
		})

		Logger.debug(
			`🏃 [primitiveFollowing] Начинаю следование за ${targetEntity.name || targetEntity.type} на дистанции ${distance} блоков`
		)

		// Создаем GoalFollow и запускаем pathfinder
		const followGoal = new GoalFollow(targetEntity, distance)
		api.bot.pathfinder.setGoal(followGoal, true) // true = dynamic goal

		Logger.debug('🗺️ [primitiveFollowing] Pathfinder запущен с GoalFollow')
	},

	onTick: api => {
		const { target, isFollowing } = api.state

		if (!isFollowing) return

		// Только проверяем существует ли цель
		if (target && (target as Entity).id) {
			const entity = target as Entity
			const stillExists = api.bot.entities[entity.id]

			if (!stillExists) {
				Logger.warn('⚠️ [primitiveFollowing] Цель исчезла')
				api.bot.pathfinder.setGoal(null)
				api.setState({ isFollowing: false })
				api.sendBack({
					type: 'FOLLOWING_STOPPED',
					reason: 'Цель исчезла'
				})
				return
			}

			// Все остальное pathfinder делает сам!
			// - Обновляет путь к движущейся цели (GoalFollow.dynamic)
			// - Управляет движением (forward, sprint, jump)
			// - Останавливается на distance
		}
	},

	onCleanup: ({ bot, setState }) => {
		Logger.debug('🧹 [primitiveFollowing] Cleanup')

		// Останавливаем pathfinder
		try {
			bot.pathfinder.setGoal(null)
			Logger.debug('🛑 [primitiveFollowing] Pathfinder остановлен')
		} catch (error) {
			Logger.error('❌ [primitiveFollowing] Ошибка при остановке', {
				error: error instanceof Error ? error.message : String(error),
				stack: error instanceof Error ? error.stack : undefined
			})
		}

		setState({ isFollowing: false, target: null })
	}
})
