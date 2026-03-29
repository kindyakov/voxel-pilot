import {
	type BaseServiceState,
	createStatefulService
} from '@/hsm/helpers/createStatefulService'

import type { Block } from '@/types'

interface CraftInWorkbenchState extends BaseServiceState {
	itemName: string | null
	count: number
	craftingTable: Block | null
}

interface CraftInWorkbenchOptions {
	itemName: string // Название предмета для крафта
	craftingTable: Block // Блок верстака
	count?: number // Количество (по умолчанию 1)
}

export const primitiveCraftInWorkbench = createStatefulService<
	CraftInWorkbenchState,
	CraftInWorkbenchOptions
>({
	name: 'primitiveCraftInWorkbench',
	initialState: {
		itemName: null,
		count: 1,
		craftingTable: null
	},

	onStart: async ({ sendBack, setState, input, bot, abortSignal }) => {
		const { itemName, craftingTable, count = 1 } = input

		if (!itemName) {
			console.error('❌ [primitiveCraftInWorkbench] No itemName provided')
			sendBack({ type: 'CRAFT_FAILED', reason: 'No itemName provided' })
			return
		}

		if (!craftingTable) {
			console.error('❌ [primitiveCraftInWorkbench] No craftingTable provided')
			sendBack({ type: 'CRAFT_FAILED', reason: 'No craftingTable provided' })
			return
		}

		setState({ itemName, count, craftingTable })

		try {
			// Проверка отмены
			if (abortSignal.aborted) return

			console.log(
				`🔨 [primitiveCraftInWorkbench] Крафт ${itemName} x${count} в верстаке на ${craftingTable.position}`
			)

			// Получаем предмет из реестра
			const item = bot.registry.itemsByName[itemName]

			if (!item) {
				console.error(
					`❌ [primitiveCraftInWorkbench] Unknown item: ${itemName}`
				)
				sendBack({
					type: 'CRAFT_FAILED',
					reason: `Unknown item: ${itemName}`
				})
				return
			}

			// Проверяем расстояние до верстака
			const distance = bot.entity.position.distanceTo(craftingTable.position)
			if (distance > 4) {
				console.error(
					`❌ [primitiveCraftInWorkbench] Crafting table too far away (${distance.toFixed(1)}m)`
				)
				sendBack({
					type: 'CRAFT_FAILED',
					reason: `Crafting table too far away (${distance.toFixed(1)}m)`
				})
				return
			}

			// Ищем рецепты для этого предмета (с верстаком)
			const recipes = bot.recipesFor(item.id, null, 1, craftingTable)

			if (recipes.length === 0) {
				console.error(
					`❌ [primitiveCraftInWorkbench] No crafting recipe found for ${itemName}`
				)
				sendBack({
					type: 'CRAFT_FAILED',
					reason: `No crafting recipe found for ${itemName}`
				})
				return
			}

			// Берём первый подходящий рецепт
			const recipe = recipes[0]

			if (!recipe) {
				console.error(
					`❌ [primitiveCraftInWorkbench] No valid recipe found for ${itemName}`
				)
				sendBack({
					type: 'CRAFT_FAILED',
					reason: `No valid recipe found for ${itemName}`
				})
				return
			}

			// Проверка отмены
			if (abortSignal.aborted) return

			// Запоминаем количество предмета до крафта
			const countBefore = bot.utils.countItemInInventory(item.id)

			// Крафтим с верстаком
			await bot.craft(recipe, count, craftingTable)

			// Проверка отмены
			if (abortSignal.aborted) return

			const countAfter = bot.utils.countItemInInventory(item.id)
			const crafted = countAfter - countBefore

			console.log(
				`✅ [primitiveCraftInWorkbench] Скрафчено ${itemName} x${crafted} (было: ${countBefore}, стало: ${countAfter})`
			)

			sendBack({
				type: 'CRAFTED',
				itemName,
				count: crafted
			})
		} catch (error) {
			if (abortSignal.aborted) {
				console.log('⚠️ [primitiveCraftInWorkbench] Aborted')
				return
			}

			console.error('❌ [primitiveCraftInWorkbench] Error:', error)
			sendBack({
				type: 'CRAFT_FAILED',
				reason: error instanceof Error ? error.message : 'Unknown error'
			})
		}
	}
})
