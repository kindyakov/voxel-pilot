import type { Block } from '@/types'
import {
	createStatefulService,
	type BaseServiceState
} from '@/hsm/helpers/createStatefulService'

interface SearchBlockState extends BaseServiceState {
	blockName: string
	maxDistance: number
	count: number
	blockId?: number
	searching: boolean
}

interface SearchBlockOptions {
	blockName: string
	maxDistance?: number
	count?: number
}

const optDefault = {
	maxDistance: 50,
	count: 1
}

export const primitiveSearchBlock = createStatefulService<
	SearchBlockState,
	SearchBlockOptions
>({
	name: 'primitiveSearchBlock',
	tickInterval: 1000,
	initialState: {
		blockName: '',
		maxDistance: optDefault.maxDistance,
		count: optDefault.count,
		searching: false
	},

	onStart: api => {
		const {
			blockName,
			maxDistance = optDefault.maxDistance,
			count = optDefault.count
		} = api.input

		if (!blockName) {
			console.error('[primitiveSearchBlock] ❌ Missing blockName')
			api.sendBack({
				type: 'NOT_FOUND',
				reason: 'Missing required parameter: blockName'
			})
			return
		}

		// Конвертируем name → ID
		const blockData = api.bot.registry.blocksByName[blockName]

		if (!blockData) {
			console.error(`[primitiveSearchBlock] ❌ Unknown block: ${blockName}`)
			api.sendBack({
				type: 'NOT_FOUND',
				reason: `Unknown block type: ${blockName}`
			})
			return
		}

		api.setState({
			blockName,
			blockId: blockData.id,
			maxDistance,
			count,
			searching: true
		})

		console.log(
			`🔍 [primitiveSearchBlock] Searching for ${blockName} (ID: ${blockData.id}, max: ${maxDistance}m, count: ${count})`
		)
	},

	onTick: api => {
		const { blockName, maxDistance, searching, blockId } = api.state

		if (!searching || !blockId) return

		const botPos = api.bot.entity.position
		const botY = botPos.y

		// Находим ВСЕ блоки в радиусе
		const blockPositions = api.bot.findBlocks({
			matching: blockId,
			maxDistance,
			count: 100 // Ищем много блоков для выбора
		})

		if (blockPositions.length === 0) {
			// Блоки не найдены, продолжаем поиск
			return
		}

		// Анализируем и приоритизируем блоки
		const analyzedBlocks = blockPositions
			.map(pos => {
				const block = api.bot.blockAt(pos)
				if (!block) return null

				const distanceHorizontal = Math.sqrt(
					Math.pow(pos.x - botPos.x, 2) + Math.pow(pos.z - botPos.z, 2)
				)
				const distanceTotal = botPos.distanceTo(pos)
				const yDiff = pos.y - botY

				return {
					block,
					position: pos,
					distanceHorizontal,
					distanceTotal,
					yDiff
				}
			})
			.filter(b => b !== null)

		if (analyzedBlocks.length === 0) {
			return
		}

		// Фильтруем опасные блоки (прямо под ногами)
		const safeBlocks = analyzedBlocks.filter(b => {
			// Блок под ногами (Y ниже И горизонтально близко)
			if (b.yDiff < 0 && b.distanceHorizontal < 2) {
				return false // Опасно - можем упасть
			}
			return true
		})

		if (safeBlocks.length === 0) {
			console.log(
				'⚠️ [primitiveSearchBlock] All blocks are unsafe (under feet)'
			)
			return
		}

		// Сортируем по приоритету
		const prioritizedBlocks = safeBlocks.sort((a, b) => {
			// Приоритет 1: Точно на той же высоте
			const aExactLevel = a.yDiff === 0
			const bExactLevel = b.yDiff === 0
			if (aExactLevel && !bExactLevel) return -1
			if (!aExactLevel && bExactLevel) return 1

			// Приоритет 2: Выше бота (любая высота)
			const aAbove = a.yDiff > 0
			const bAbove = b.yDiff > 0
			if (aAbove && !bAbove) return -1
			if (!aAbove && bAbove) return 1

			// Приоритет 3: Чуть ниже (только -1)
			const aSlightlyBelow = a.yDiff === -1
			const bSlightlyBelow = b.yDiff === -1
			if (aSlightlyBelow && !bSlightlyBelow) return -1
			if (!aSlightlyBelow && bSlightlyBelow) return 1

			// Приоритет 4: Ближе по расстоянию
			return a.distanceTotal - b.distanceTotal
		})

		const best = prioritizedBlocks[0]

		if (!best) {
			console.log('⚠️ [primitiveSearchBlock] No suitable block found')
			return
		}

		console.log(
			`✅ [primitiveSearchBlock] Found ${blockName} at ${best.position} (Y diff: ${best.yDiff.toFixed(1)}, distance: ${best.distanceTotal.toFixed(1)}m)`
		)

		// Останавливаем поиск
		api.setState({ searching: false })

		// Отправляем результат
		api.sendBack({
			type: 'FOUND',
			block: best.block
		})
	},

	onCleanup: ({ setState }) => {
		console.log(`🧹 [primitiveSearchBlock] Cleanup`)
	}
})
