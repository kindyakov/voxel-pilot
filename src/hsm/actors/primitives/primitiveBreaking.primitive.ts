import type { Block } from '@types'
import {
	createStatefulService,
	type BaseServiceState
} from '@/hsm/helpers/createStatefulService'
import { GoalNear } from '@/modules/plugins/goals'
import utils from '@utils/general/index.general.utils'

interface PrimitiveBreakingState extends BaseServiceState {
	block: Block | null
}

interface BreakingOptions {
	block: Block
}

export const primitiveBreaking = createStatefulService<
	PrimitiveBreakingState,
	BreakingOptions
>({
	name: 'primitiveBreaking',
	initialState: {
		block: null
	},

	onStart: async ({ sendBack, setState, input, bot, abortSignal }) => {
		const { block } = input

		if (!block) {
			console.error('❌ primitiveBreaking: No block provided')
			sendBack({ type: 'BREAKING_FAILED', reason: 'No block' })
			return
		}

		setState({ block })

		try {
			// Проверка отмены
			if (abortSignal.aborted) return

			// Экипируем инструмент
			await bot.tool.equipForBlock(block, { requireHarvest: true })

			// Проверка отмены
			if (abortSignal.aborted) return

			console.log(
				`⛏️ [primitiveBreaking] Breaking ${block.name} at ${block.position}`
			)

			// Ожидаемый дроп
			const expectedItemDrop = block.drops?.[0]

			if (!expectedItemDrop) {
				console.log(
					'⚠️ [primitiveBreaking] Block has no drops, skipping collection'
				)
				await bot.dig(block)
				sendBack({ type: 'BROKEN' })
				return
			}

			// Нормализуем drop - может быть number или объект
			const expectedItemId: number =
				typeof expectedItemDrop === 'number'
					? expectedItemDrop
					: typeof expectedItemDrop.drop === 'number'
						? expectedItemDrop.drop
						: expectedItemDrop.drop.id

			// Запоминаем количество до копания
			const countBefore = bot.utils.countItemInInventory(expectedItemId)
			console.log(
				`📊 [primitiveBreaking] ${block.name} in inventory before: ${countBefore}`
			)

			// Копаем блок
			await bot.dig(block)
			console.log(`✅ [primitiveBreaking] Block broken: ${block.name}`)

			// Проверка отмены после копания
			if (abortSignal.aborted) return

			// Ждём спавн item'а
			await utils.sleep(500)

			// Ищем выпавший предмет
			const item = bot.nearestEntity((e: any) => {
				if (e.name !== 'item') return false
				const itemId = e.metadata?.[8]?.itemId
				return itemId === expectedItemId
			})

			if (!item) {
				console.log('⚠️ [primitiveBreaking] Item entity not found in world')

				// Проверяем инвентарь на всякий случай
				const countAfter = bot.utils.countItemInInventory(expectedItemId)
				if (countAfter > countBefore) {
					console.log(
						`✅ [primitiveBreaking] Item auto-collected (${countAfter - countBefore})`
					)
				}

				sendBack({ type: 'BROKEN' })
				return
			}

			const distance = bot.entity.position.distanceTo(item.position)
			console.log(
				`📦 [primitiveBreaking] Found item at distance: ${distance.toFixed(2)}`
			)

			// Если item далеко - идём к нему
			if (distance >= 0.5) {
				console.log(`🏃 [primitiveBreaking] Navigating to item...`)
				const { x, y, z } = item.position
				bot.pathfinder.setGoal(new GoalNear(x, y, z, 0.5))

				// Ждём подбор через проверку инвентаря
				const collected = await bot.utils.waitForInventoryChange(
					expectedItemId,
					countBefore,
					3000
				)

				// Останавливаем навигацию
				bot.pathfinder.setGoal(null)

				if (collected) {
					const countAfter = bot.utils.countItemInInventory(expectedItemId)
					console.log(
						`✅ [primitiveBreaking] Item collected (+${countAfter - countBefore})`
					)
				} else {
					console.log(`⚠️ [primitiveBreaking] Failed to collect item (timeout)`)
				}
			} else {
				console.log(
					`✅ [primitiveBreaking] Item is nearby, waiting for auto-collect...`
				)

				// Даём время на автоподбор
				await bot.utils.waitForInventoryChange(
					expectedItemId,
					countBefore,
					2000
				)

				const countAfter = bot.utils.countItemInInventory(expectedItemId)
				if (countAfter > countBefore) {
					console.log(
						`✅ [primitiveBreaking] Item auto-collected (+${countAfter - countBefore})`
					)
				}
			}

			// В любом случае - блок успешно сломан
			sendBack({ type: 'BROKEN' })
		} catch (error) {
			if (abortSignal.aborted) {
				console.log('⚠️ [primitiveBreaking] Aborted')
				return
			}

			console.error('❌ [primitiveBreaking] Error:', error)
			sendBack({
				type: 'BREAKING_FAILED',
				reason: error instanceof Error ? error.message : 'Unknown error'
			})
		}
	}
})
