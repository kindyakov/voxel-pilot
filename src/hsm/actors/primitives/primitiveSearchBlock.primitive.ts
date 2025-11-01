import type { Vec3 } from '@/types'
import {
	createStatefulService,
	type BaseServiceState
} from '@/hsm/helpers/createStatefulService'
import {
	checkBlockSafety,
	isBlockDirectlyBelowBot,
	calculateBlockScore,
	type AnalyzedBlock
} from '@/hsm/utils/blockAnalysis.utils'

interface SearchBlockState extends BaseServiceState {
	blockName: string
	maxDistance: number
	count: number
	blockId?: number
	searching: boolean
	lastMinedPosition?: Vec3 | null
}

interface SearchBlockOptions {
	blockName: string
	maxDistance?: number
	count?: number
}

const optDefault = {
	maxDistance: 100,
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
		searching: false,
		lastMinedPosition: null
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
			`🔍 [primitiveSearchBlock] В поисках ${blockName} (ID: ${blockData.id}, max: ${maxDistance}m, count: ${count})`
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
			count: 100
		})

		if (blockPositions.length === 0) {
			return
		}

		// Анализируем блоки
		const analyzedBlocks: AnalyzedBlock[] = blockPositions
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
			.filter(b => b !== null) as AnalyzedBlock[]

		if (analyzedBlocks.length === 0) {
			return
		}

		// Фильтруем опасные блоки
		const safeBlocks = analyzedBlocks.filter(b => {
			// Фильтр 1: Блок прямо под ногами бота
			if (isBlockDirectlyBelowBot(api.bot, b.position)) {
				console.log(
					`⚠️ [primitiveSearchBlock] Пропуск блока под ногами бота: ${b.position}`
				)
				return false
			}

			// Фильтр 2: Опасность под целевым блоком
			const safetyCheck = checkBlockSafety(api.bot, b.position)
			if (!safetyCheck.isSafe) {
				console.log(
					`⚠️ [primitiveSearchBlock] Пропуск блока в ${b.position} - ${safetyCheck.reason}`
				)
				return false
			}

			return true
		})

		if (safeBlocks.length === 0) {
			console.log('⚠️ [primitiveSearchBlock] Все блоки небезопасны')
			return
		}

		// 🔥 ВЗВЕШЕННАЯ СОРТИРОВКА (бонус за Y - штраф за расстояние)
		const prioritizedBlocks = safeBlocks.sort((a, b) => {
			const aScore = calculateBlockScore(a)
			const bScore = calculateBlockScore(b)
			return bScore - aScore // Больше = лучше
		})

		const best = prioritizedBlocks[0]

		if (!best) {
			console.log('⚠️ [primitiveSearchBlock] Подходящий блок не найден')
			return
		}

		console.log(
			`✅ [primitiveSearchBlock] Нашел ${blockName} на ${best.position} ` +
				`(Y diff: ${best.yDiff.toFixed(1)}, distance: ${best.distanceTotal.toFixed(1)}m, ` +
				`score: ${calculateBlockScore(best).toFixed(1)})`
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
