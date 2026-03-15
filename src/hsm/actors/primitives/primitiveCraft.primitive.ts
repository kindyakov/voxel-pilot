import type { Item } from '@types'
import {
	createStatefulService,
	type BaseServiceState
} from '@/hsm/helpers/createStatefulService'

interface CraftState extends BaseServiceState {
	itemName: string | null
	count: number
}

interface CraftOptions {
	itemName: string // Название предмета для крафта
	count?: number // Количество (по умолчанию 1)
}

export const primitiveCraft = createStatefulService<CraftState, CraftOptions>({
	name: 'primitiveCraft',
	initialState: {
		itemName: null,
		count: 1
	},

	onStart: async ({ sendBack, setState, input, bot, abortSignal }) => {
		const { itemName, count = 1 } = input

		if (!itemName) {
			console.error('❌ [primitiveCraft] No itemName provided')
			sendBack({ type: 'CRAFT_FAILED', reason: 'No itemName provided' })
			return
		}

		setState({ itemName, count })

		try {
			// Проверка отмены
			if (abortSignal.aborted) return

			console.log(`🔨 [primitiveCraft] Крафт ${itemName} x${count}`)

			// Получаем рецепт из реестра
			const item = bot.registry.itemsByName[itemName]

			if (!item) {
				console.error(`❌ [primitiveCraft] Unknown item: ${itemName}`)
				sendBack({
					type: 'CRAFT_FAILED',
					reason: `Unknown item: ${itemName}`
				})
				return
			}

			// Ищем рецепт для этого предмета (без верстака - только 2x2)
			const recipes = bot.recipesFor(item.id, null, 1, null)

			if (recipes.length === 0) {
				console.error(
					`❌ [primitiveCraft] No crafting recipe found for ${itemName}`
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
					`❌ [primitiveCraft] No valid recipe found for ${itemName}`
				)
				sendBack({
					type: 'CRAFT_FAILED',
					reason: `No valid recipe found for ${itemName}`
				})
				return
			}

			// Проверяем, можно ли скрафтить без верстака (рецепт 2x2 или меньше)
			if (recipe.requiresTable) {
				console.error(
					`❌ [primitiveCraft] Recipe for ${itemName} requires crafting table`
				)
				sendBack({
					type: 'CRAFT_FAILED',
					reason: `Recipe requires crafting table`
				})
				return
			}

			// Проверка отмены
			if (abortSignal.aborted) return

			// Запоминаем количество предмета до крафта
			const countBefore = bot.utils.countItemInInventory(item.id)

			// Крафтим без верстака (null)
			await bot.craft(recipe, count, null)

			// Проверка отмены
			if (abortSignal.aborted) return

			const countAfter = bot.utils.countItemInInventory(item.id)
			const crafted = countAfter - countBefore

			console.log(
				`✅ [primitiveCraft] Скрафчено ${itemName} x${crafted} (было: ${countBefore}, стало: ${countAfter})`
			)

			sendBack({
				type: 'CRAFTED',
				itemName,
				count: crafted
			})
		} catch (error) {
			if (abortSignal.aborted) {
				console.log('⚠️ [primitiveCraft] Aborted')
				return
			}

			console.error('❌ [primitiveCraft] Error:', error)
			sendBack({
				type: 'CRAFT_FAILED',
				reason: error instanceof Error ? error.message : 'Unknown error'
			})
		}
	}
})
