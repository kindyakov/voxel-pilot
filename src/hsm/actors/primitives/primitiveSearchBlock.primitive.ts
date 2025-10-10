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
				block
			})
		}
	},

	onCleanup: api => {
		console.log(`🧹 [primitiveSearchBlock] Cleanup`)
	}
})
