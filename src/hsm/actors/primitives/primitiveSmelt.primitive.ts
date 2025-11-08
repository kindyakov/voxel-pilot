import type { Block, Item } from '@types'
import {
	createStatefulService,
	type BaseServiceState
} from '@/hsm/helpers/createStatefulService'
import utils from '@utils/general/index.general.utils'

interface SmeltState extends BaseServiceState {
	inputItemName: string | null
	fuelItemName: string | null
	count: number
	furnace: Block | null
	furnaceWindow: any | null
}

interface SmeltOptions {
	inputItemName: string // Что плавить (например, 'iron_ore')
	fuelItemName?: string // Топливо (например, 'coal'), по умолчанию 'coal'
	furnace: Block // Блок печи
	count?: number // Количество для плавки (по умолчанию 1)
}

export const primitiveSmelt = createStatefulService<SmeltState, SmeltOptions>({
	name: 'primitiveSmelt',
	initialState: {
		inputItemName: null,
		fuelItemName: null,
		count: 1,
		furnace: null,
		furnaceWindow: null
	},

	onStart: async ({ sendBack, setState, input, bot, abortSignal }) => {
		const { inputItemName, fuelItemName = 'coal', furnace, count = 1 } = input

		if (!inputItemName) {
			console.error('❌ [primitiveSmelt] No inputItemName provided')
			sendBack({ type: 'SMELT_FAILED', reason: 'No inputItemName provided' })
			return
		}

		if (!furnace) {
			console.error('❌ [primitiveSmelt] No furnace provided')
			sendBack({ type: 'SMELT_FAILED', reason: 'No furnace provided' })
			return
		}

		setState({ inputItemName, fuelItemName, count, furnace })

		try {
			// Проверка отмены
			if (abortSignal.aborted) return

			console.log(
				`🔥 [primitiveSmelt] Плавка ${inputItemName} x${count} в печи на ${furnace.position} с топливом ${fuelItemName}`
			)

			// Проверяем расстояние до печи
			const distance = bot.entity.position.distanceTo(furnace.position)
			if (distance > 4) {
				console.error(
					`❌ [primitiveSmelt] Furnace too far away (${distance.toFixed(1)}m)`
				)
				sendBack({
					type: 'SMELT_FAILED',
					reason: `Furnace too far away (${distance.toFixed(1)}m)`
				})
				return
			}

			// Получаем предметы из реестра
			const inputItem = bot.registry.itemsByName[inputItemName]
			const fuelItem = bot.registry.itemsByName[fuelItemName]

			if (!inputItem) {
				console.error(`❌ [primitiveSmelt] Unknown input item: ${inputItemName}`)
				sendBack({
					type: 'SMELT_FAILED',
					reason: `Unknown input item: ${inputItemName}`
				})
				return
			}

			if (!fuelItem) {
				console.error(`❌ [primitiveSmelt] Unknown fuel item: ${fuelItemName}`)
				sendBack({
					type: 'SMELT_FAILED',
					reason: `Unknown fuel item: ${fuelItemName}`
				})
				return
			}

			// Проверяем наличие предметов в инвентаре
			const inputCount = bot.utils.countItemInInventory(inputItem.id)
			const fuelCount = bot.utils.countItemInInventory(fuelItem.id)

			if (inputCount < count) {
				console.error(
					`❌ [primitiveSmelt] Not enough ${inputItemName} in inventory (need: ${count}, have: ${inputCount})`
				)
				sendBack({
					type: 'SMELT_FAILED',
					reason: `Not enough ${inputItemName} in inventory`
				})
				return
			}

			if (fuelCount < 1) {
				console.error(
					`❌ [primitiveSmelt] No ${fuelItemName} in inventory for fuel`
				)
				sendBack({
					type: 'SMELT_FAILED',
					reason: `No ${fuelItemName} in inventory for fuel`
				})
				return
			}

			// Проверка отмены
			if (abortSignal.aborted) return

			// Открываем печь
			const furnaceWindow = await (bot as any).openFurnace(furnace)
			setState({ furnaceWindow })

			// Проверка отмены
			if (abortSignal.aborted) {
				furnaceWindow.close()
				return
			}

			// Получаем предметы из инвентаря
			const inputItemStack = bot.inventory
				.items()
				.find((item: Item) => item.type === inputItem.id)
			const fuelItemStack = bot.inventory
				.items()
				.find((item: Item) => item.type === fuelItem.id)

			if (!inputItemStack || !fuelItemStack) {
				furnaceWindow.close()
				console.error('❌ [primitiveSmelt] Items not found in inventory')
				sendBack({
					type: 'SMELT_FAILED',
					reason: 'Items not found in inventory'
				})
				return
			}

			// Кладём предмет для плавки (slot 0 - input)
			await furnaceWindow.putItem(0, inputItemStack, count)
			console.log(
				`📥 [primitiveSmelt] Положил ${inputItemName} x${count} в печь`
			)

			// Проверка отмены
			if (abortSignal.aborted) {
				furnaceWindow.close()
				return
			}

			// Кладём топливо (slot 1 - fuel)
			await furnaceWindow.putItem(1, fuelItemStack, 1)
			console.log(`📥 [primitiveSmelt] Положил ${fuelItemName} x1 как топливо`)

			// Проверка отмены
			if (abortSignal.aborted) {
				furnaceWindow.close()
				return
			}

			// Ждём завершения плавки
			// Время плавки одного предмета ~10 секунд
			const waitTime = count * 10000 + 2000 // +2 секунды запас

			console.log(
				`⏳ [primitiveSmelt] Ожидание плавки (~${(waitTime / 1000).toFixed(1)}s)...`
			)

			await utils.sleep(waitTime)

			// Проверка отмены
			if (abortSignal.aborted) {
				furnaceWindow.close()
				return
			}

			// Забираем результат (slot 2 - output)
			const outputSlot = furnaceWindow.slots[2]
			if (outputSlot) {
				await furnaceWindow.takeItem(2, null, outputSlot.count)
				console.log(
					`✅ [primitiveSmelt] Забрал результат: ${outputSlot.name} x${outputSlot.count}`
				)
			}

			// Закрываем печь
			furnaceWindow.close()
			setState({ furnaceWindow: null })

			sendBack({
				type: 'SMELTED',
				inputItemName,
				count,
				outputItem: outputSlot ? outputSlot.name : null
			})
		} catch (error) {
			if (abortSignal.aborted) {
				console.log('⚠️ [primitiveSmelt] Aborted')
				return
			}

			console.error('❌ [primitiveSmelt] Error:', error)
			sendBack({
				type: 'SMELT_FAILED',
				reason: error instanceof Error ? error.message : 'Unknown error'
			})
		}
	},

	onCleanup: ({ state }) => {
		console.log(`🧹 [primitiveSmelt] Cleanup`)

		// Закрываем окно печи при очистке
		if (state.furnaceWindow) {
			try {
				state.furnaceWindow.close()
				console.log(`🔒 [primitiveSmelt] Furnace window closed`)
			} catch (error) {
				console.error(
					`❌ [primitiveSmelt] Error closing furnace window:`,
					error
				)
			}
		}
	}
})
