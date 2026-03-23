import type { Entity } from '@types'

import { createStatefulService } from '@hsm/helpers/createStatefulService'
import { isEntityOfType } from '@hsm/utils/isEntityOfType'

import { canAttackEnemy } from '@utils/combat/enemyVisibility'

const serviceEntitiesTracking = createStatefulService({
	name: 'serviceEntitiesTracking',
	asyncTickInterval: 100,

	onAsyncTick: async ({ bot, getContext, sendBack, abortSignal }) => {
		const context = getContext()

		if (!bot?.entities || !context.position) {
			return
		}

		// 1. Собираем всех сущностей
		const allEntities = (Object.values(context.bot!.entities) as Entity[])
			.filter(
				(entity: Entity) =>
					entity &&
					entity !== context.bot?.entity &&
					entity.position &&
					entity.position.distanceTo(context.position!) <=
						context.preferences.maxObservDist
			)
			.sort((a: Entity, b: Entity) => {
				const distA = a.position.distanceTo(context.position!)
				const distB = b.position.distanceTo(context.position!)
				return distA - distB
			})

		// 2. Разделяем на дружественные и враждебные
		const entities: Entity[] = allEntities.filter(e => !isEntityOfType(e))
		const enemies: Entity[] = allEntities.filter(e => isEntityOfType(e))
		const players: Entity[] = allEntities.filter(e => e.type === 'player')

		// 3. Фильтруем врагов для атаки (≤ maxDistToEnemy)
		const attackCandidates = enemies.filter(
			enemy =>
				enemy.position.distanceTo(context.position!) <=
				context.preferences.maxDistToEnemy
		)

		// 4. Проверяем достижимость каждого кандидата через 3-уровневую фильтрацию
		let nearestEnemy: { entity: Entity | null; distance: number } = {
			entity: null,
			distance: Infinity
		}

		for (const enemy of attackCandidates) {
			// Проверяем отмену
			if (abortSignal.aborted) {
				console.log('⚠️ [serviceEntitiesTracking] Async операция отменена')
				return
			}

			const canAttack = await canAttackEnemy(
				bot,
				enemy,
				context.preferences.maxDistToEnemy,
				context.preferences.maxDistToEnemy *
					context.preferences.maxPathLengthMultiplier,
				context.preferences.pathfindTimeout,
				context.isActiveTask
			)

			if (canAttack) {
				const distance = enemy.position.distanceTo(context.position!)

				// Выбираем ближайшего достижимого
				if (distance < nearestEnemy.distance) {
					nearestEnemy = { entity: enemy, distance }
				}
			}
		}

		// 5. Отправляем обновлённые данные в HSM
		sendBack({
			type: 'UPDATE_ENTITIES',
			entities,
			enemies, // Все враги ≤ maxObservDist
			players,
			nearestEnemy // Ближайший достижимый враг (цель для атаки)
		})
	}
})

export default {
	serviceEntitiesTracking
}
