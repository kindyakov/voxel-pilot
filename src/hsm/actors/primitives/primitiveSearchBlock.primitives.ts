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

export const primitiveSearchBlock = createStatefulService<SearchBlockState>({
	name: 'primitiveSearchBlock',
	tickInterval: 1000,
	initialState: {
		blockName: '',
		maxDistance: 64,
		count: 1,
		searching: false
	},
	onStart: api => {
		const { blockType, maxDistance = 64, count = 1 } = api.input

		if (!blockType) {
			console.error('[primitiveSearchBlock] ❌ Missing blockType')
			api.sendBack({
				type: 'NOT_FOUND',
				reason: 'Missing required parameter: blockType'
			})
			return
		}

		// Конвертируем name → ID
		const blockData = api.bot.registry.blocksByName[blockType]

		if (!blockData) {
			console.error(`[primitiveSearchBlock] ❌ Unknown block: ${blockType}`)
			api.sendBack({
				type: 'NOT_FOUND',
				reason: `Unknown block type: ${blockType}`
			})
			return
		}

		api.setState({
			blockName: blockType,
			blockId: blockData.id,
			maxDistance,
			count,
			searching: true
		})

		console.log(
			`🔍 [primitiveSearchBlock] Searching for ${blockType} (ID: ${blockData.id}, max: ${maxDistance}m, count: ${count})`
		)
	},

	onTick: api => {
		const { blockName, maxDistance, count, searching, blockId } = api.state

		if (!searching || !blockId) return

		// Используем параметры
		const block: Block | null = api.bot.findBlock({
			matching: blockId, // ← Передаём ID напрямую
			maxDistance,
			count
		})

		if (block) {
			console.log(
				`✅ [primitiveSearchBlock] Found ${blockName} at ${block.position}`
			)

			// Останавливаем поиск
			api.setState({ searching: false })

			// Отправляем результат
			api.sendBack({
				type: 'FOUND',
				block,
				blockName: api.state.blockName
			})
		}
	},

	onCleanup: api => {
		console.log(`🧹 [primitiveSearchBlock] Cleanup`)
	}
})
