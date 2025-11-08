import type { Block } from '@types'
import {
	createStatefulService,
	type BaseServiceState
} from '@/hsm/helpers/createStatefulService'

interface OpenContainerState extends BaseServiceState {
	block: Block | null
	containerWindow: any | null
}

interface OpenContainerOptions {
	block: Block
}

// Список блоков, которые являются контейнерами
const CONTAINER_BLOCKS = [
	'chest',
	'trapped_chest',
	'ender_chest',
	'furnace',
	'blast_furnace',
	'smoker',
	'dispenser',
	'dropper',
	'hopper',
	'barrel',
	'shulker_box',
	'brewing_stand',
	'crafting_table',
	'cartography_table',
	'smithing_table',
	'grindstone',
	'loom',
	'stonecutter',
	'enchanting_table',
	'anvil'
]

export const primitiveOpenContainer = createStatefulService<
	OpenContainerState,
	OpenContainerOptions
>({
	name: 'primitiveOpenContainer',
	initialState: {
		block: null,
		containerWindow: null
	},

	onStart: async ({ sendBack, setState, input, bot, abortSignal }) => {
		const { block } = input

		if (!block) {
			console.error('❌ [primitiveOpenContainer] Не предоставлен block')
			sendBack({ type: 'OPEN_FAILED', reason: 'Не предоставлен block' })
			return
		}

		setState({ block })

		// Проверяем, является ли блок контейнером
		const isContainer = CONTAINER_BLOCKS.some(containerName =>
			block.name.includes(containerName)
		)

		if (!isContainer) {
			console.error(
				`❌ [primitiveOpenContainer] Блок ${block.name} не является контейнером`
			)
			sendBack({
				type: 'OPEN_FAILED',
				reason: `Блок ${block.name} не является контейнером`
			})
			return
		}

		try {
			// Проверка отмены
			if (abortSignal.aborted) return

			console.log(
				`📦 [primitiveOpenContainer] Открытие ${block.name} в ${block.position}`
			)

			// Проверяем расстояние до блока
			const distance = bot.entity.position.distanceTo(block.position)
			if (distance > 4) {
				console.error(
					`❌ [primitiveOpenContainer] Блок находится слишком далеко (${distance.toFixed(1)}m)`
				)
				sendBack({
					type: 'OPEN_FAILED',
					reason: `Блок находится слишком далеко (${distance.toFixed(1)}m)`
				})
				return
			}

			// Проверка отмены
			if (abortSignal.aborted) return

			// Открываем контейнер
			// В зависимости от типа блока используем разные методы
			let containerWindow: any = null

			if (block.name.includes('chest')) {
				// Для сундуков используем openChest
				containerWindow = await (bot as any).openChest(block)
			} else if (
				block.name.includes('crafting_table') ||
				block.name.includes('cartography_table') ||
				block.name.includes('smithing_table') ||
				block.name.includes('grindstone') ||
				block.name.includes('loom') ||
				block.name.includes('stonecutter') ||
				block.name.includes('enchanting_table') ||
				block.name.includes('anvil')
			) {
				// Для верстаков и подобных блоков используем openBlock
				containerWindow = await (bot as any).openBlock(block)
			} else {
				// Для остальных контейнеров используем openContainer
				containerWindow = await (bot as any).openContainer(block)
			}

			// Проверка отмены
			if (abortSignal.aborted) {
				// Закрываем контейнер если он был открыт
				if (containerWindow) {
					containerWindow.close()
				}
				return
			}

			console.log(
				`✅ [primitiveOpenContainer] Открытый контейнер: ${block.name}`
			)

			setState({ containerWindow })

			// Отправляем результат с контейнером
			sendBack({
				type: 'OPENED',
				container: containerWindow,
				block
			})
		} catch (error) {
			if (abortSignal.aborted) {
				console.log('⚠️ [primitiveOpenContainer] Aborted')
				return
			}

			console.error('❌ [primitiveOpenContainer] Error:', error)
			sendBack({
				type: 'OPEN_FAILED',
				reason: error instanceof Error ? error.message : 'Unknown error'
			})
		}
	},

	onCleanup: ({ state }) => {
		console.log(`🧹 [primitiveOpenContainer] Cleanup`)

		// Закрываем контейнер при очистке
		if (state.containerWindow) {
			try {
				state.containerWindow.close()
				console.log(`🔒 [primitiveOpenContainer] Закрытый контейнер`)
			} catch (error) {
				console.error(
					`❌ [primitiveOpenContainer] Error closing container:`,
					error
				)
			}
		}
	}
})
