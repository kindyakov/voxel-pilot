import { Vec3 as Vec3Class } from 'vec3'

import type { Block, Vec3 } from '@/types'

import {
	type BaseServiceState,
	createStatefulService
} from '@/hsm/helpers/createStatefulService'

interface PlacingState extends BaseServiceState {
	blockName: string | null
	position: Vec3 | null
	referenceBlock: Block | null
}

interface PlacingOptions {
	blockName: string // Название блока для размещения
	position: Vec3 // Позиция, где нужно поставить блок
	faceVector?: Vec3 // Вектор грани (по умолчанию сверху)
}

export const primitivePlacing = createStatefulService<
	PlacingState,
	PlacingOptions
>({
	name: 'primitivePlacing',
	initialState: {
		blockName: null,
		position: null,
		referenceBlock: null
	},

	onStart: async ({ sendBack, setState, input, bot, abortSignal }) => {
		const { blockName, position, faceVector = new Vec3Class(0, 1, 0) } = input

		if (!blockName) {
			console.error('❌ [primitivePlacing] Не предоставлен blockName')
			sendBack({ type: 'PLACING_FAILED', reason: 'Не предоставлен blockName' })
			return
		}

		if (!position) {
			console.error('❌ [primitivePlacing] Не предоставлен position')
			sendBack({ type: 'PLACING_FAILED', reason: 'Не предоставлен position' })
			return
		}

		setState({ blockName, position })

		try {
			// Проверка отмены
			if (abortSignal.aborted) return

			console.log(
				`🧱 [primitivePlacing] Размещение ${blockName} на позиции ${position}`
			)

			// Получаем блок из реестра
			const blockData = bot.registry.blocksByName[blockName]

			if (!blockData) {
				console.error(`❌ [primitivePlacing] Неизвестный блок: ${blockName}`)
				sendBack({
					type: 'PLACING_FAILED',
					reason: `Неизвестный блок: ${blockName}`
				})
				return
			}

			// Проверяем наличие блока в инвентаре
			const blockCount = bot.utils.countItemInInventory(blockData.id)

			if (blockCount < 1) {
				console.error(
					`❌ [primitivePlacing] Нет ${blockName} в инвентаре для строительства`
				)
				sendBack({
					type: 'PLACING_FAILED',
					reason: `Нет ${blockName} в инвентаре`
				})
				return
			}

			// Находим опорный блок для размещения
			// Обычно это блок под целевой позицией
			const referencePos = position.offset(0, -1, 0)
			const referenceBlock = bot.blockAt(referencePos)

			if (!referenceBlock) {
				console.error(
					`❌ [primitivePlacing] Ни один опорный блок не найден по ${referencePos}`
				)
				sendBack({
					type: 'PLACING_FAILED',
					reason: 'Не найден опорный блок'
				})
				return
			}

			setState({ referenceBlock })

			// Проверяем расстояние до позиции размещения
			const distance = bot.entity.position.distanceTo(position)
			if (distance > 4.5) {
				console.error(
					`❌ [primitivePlacing] Позиция слишком далеко (${distance.toFixed(1)}m)`
				)
				sendBack({
					type: 'PLACING_FAILED',
					reason: `Позиция слишком далеко (${distance.toFixed(1)}m)`
				})
				return
			}

			// Проверка отмены
			if (abortSignal.aborted) return

			// Экипируем блок
			const blockItem = bot.inventory
				.items()
				.find((item: any) => item.type === blockData.id)

			if (!blockItem) {
				console.error(`❌ [primitivePlacing] blockItem не найден в инвентаре`)
				sendBack({
					type: 'PLACING_FAILED',
					reason: 'blockItem не найден в инвентаре'
				})
				return
			}

			await bot.equip(blockItem, 'hand')

			// Проверка отмены
			if (abortSignal.aborted) return

			// Размещаем блок
			await bot.placeBlock(referenceBlock, faceVector as any)

			console.log(
				`✅ [primitivePlacing] Блок ${blockName} размещён на ${position}`
			)

			sendBack({
				type: 'PLACED',
				blockName,
				position
			})
		} catch (error) {
			if (abortSignal.aborted) {
				console.log('⚠️ [primitivePlacing] Aborted')
				return
			}

			console.error('❌ [primitivePlacing] Error:', error)
			sendBack({
				type: 'PLACING_FAILED',
				reason: error instanceof Error ? error.message : 'Unknown error'
			})
		}
	}
})
