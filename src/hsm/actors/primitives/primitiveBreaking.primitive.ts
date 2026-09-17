import { setTimeout as delay } from 'node:timers/promises'

import type { Block } from '@/types/index.js'

import Logger from '@/config/logger.js'

import {
	type BaseServiceState,
	createStatefulService
} from '@/hsm/helpers/createStatefulService.js'

import { GoalNear } from '@/modules/plugins/goals.js'

interface PrimitiveBreakingState extends BaseServiceState {
	block: Block | null
}

interface BreakingOptions {
	block: Block | null
}

export const primitiveBreaking = createStatefulService<
	PrimitiveBreakingState,
	BreakingOptions
>({
	name: 'primitiveBreaking',
	timeoutMs: 30_000,
	initialState: {
		block: null
	},

	onStart: async ({ sendBack, setState, input, bot, abortSignal }) => {
		const { block } = input

		if (!block) {
			Logger.error('❌ primitiveBreaking: No block provided')
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

			Logger.debug(
				`⛏️ [primitiveBreaking] Breaking ${block.name} at ${block.position}`
			)

			// Ожидаемый дроп
			const expectedItemDrop = block.drops?.[0]

			if (!expectedItemDrop) {
				Logger.debug(
					'⚠️ [primitiveBreaking] Блока нет в списке дропов, пропускаем сбор'
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
			Logger.debug(
				`📊 [primitiveBreaking] ${block.name} в инвентаре до копания: ${countBefore}`
			)

			// Копаем блок
			await bot.dig(block)
			Logger.debug(`✅ [primitiveBreaking] Блок сломан: ${block.name}`)

			// Проверка отмены после копания
			if (abortSignal.aborted) return

			// Ждём спавн item'а
			await delay(300, undefined, { signal: abortSignal })
			if (abortSignal.aborted) return

			// Ищем выпавший предмет
			const item = bot.nearestEntity((e: any) => {
				if (e.name !== 'item') return false
				const itemId = e.metadata?.[8]?.itemId
				return itemId === expectedItemId
			})

			if (!item) {
				Logger.debug(
					'⚠️ [primitiveBreaking] Объект Item, не найденный в world после копания блока'
				)

				// Проверяем инвентарь на всякий случай
				const countAfter = bot.utils.countItemInInventory(expectedItemId)
				if (countAfter > countBefore) {
					Logger.debug(
						`✅ [primitiveBreaking] Item автоматически собран (+${countAfter - countBefore})`
					)
				}

				sendBack({ type: 'BROKEN' })
				return
			}

			const distance = bot.entity.position.distanceTo(item.position)
			Logger.debug(
				`📦 [primitiveBreaking] Найден объект Item в мире на расстоянии: ${distance.toFixed(2)}`
			)

			// Если item далеко - идём к нему
			if (distance >= 0.5) {
				Logger.debug(`🏃 [primitiveBreaking] Навигация к объекту Item...`)
				const { x, y, z } = item.position
				bot.pathfinder.setGoal(new GoalNear(x, y, z, 0.5))

				// Ждём подбор через проверку инвентаря
				const collected = await bot.utils.waitForInventoryChange(
					expectedItemId,
					countBefore,
					3000,
					abortSignal
				)
				if (abortSignal.aborted) return

				// Останавливаем навигацию
				bot.pathfinder.setGoal(null)

				if (collected) {
					const countAfter = bot.utils.countItemInInventory(expectedItemId)
					Logger.debug(
						`✅ [primitiveBreaking] Объект Item собран (+${countAfter - countBefore})`
					)
				} else {
					Logger.warn(
						`⚠️ [primitiveBreaking] Не удалось забрать объект Item (тайм-аут)`
					)
				}
			} else {
				Logger.debug(
					`✅ [primitiveBreaking] Объект Item близко, ожидание автоподбора...`
				)

				// Даём время на автоподбор
				await bot.utils.waitForInventoryChange(
					expectedItemId,
					countBefore,
					2000,
					abortSignal
				)
				if (abortSignal.aborted) return

				const countAfter = bot.utils.countItemInInventory(expectedItemId)
				if (countAfter > countBefore) {
					Logger.debug(
						`✅ [primitiveBreaking] Объект Item собран (+${countAfter - countBefore})`
					)
				} else {
					Logger.warn(
						`⚠️ [primitiveBreaking] Не удалось забрать объект Item (тайм-аут)`
					)
				}
			}

			// В любом случае - блок успешно сломан
			sendBack({ type: 'BROKEN' })
		} catch (error) {
			if (abortSignal.aborted) {
				Logger.debug('⚠️ [primitiveBreaking] Aborted')
				return
			}

			Logger.error('❌ [primitiveBreaking] Error', {
				error: error instanceof Error ? error.message : String(error),
				stack: error instanceof Error ? error.stack : undefined
			})
			sendBack({
				type: 'BREAKING_FAILED',
				reason: error instanceof Error ? error.message : 'Unknown error'
			})
		}
	},

	onCleanup: ({ bot }) => {
		Logger.debug('🧹 [primitiveBreaking] Cleanup')
		try {
			try {
				bot.stopDigging()
			} finally {
				bot.pathfinder.setGoal(null)
			}
			Logger.debug('🛑 [primitiveBreaking] Pathfinder остановлен')
		} catch (error) {
			Logger.error('❌ [primitiveBreaking] Ошибка при остановке', {
				error: error instanceof Error ? error.message : String(error),
				stack: error instanceof Error ? error.stack : undefined
			})
		}
	}
})
