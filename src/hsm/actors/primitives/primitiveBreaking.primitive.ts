import type { Block } from '@types'
import {
	createStatefulService,
	type BaseServiceState
} from '@/hsm/helpers/createStatefulService'

interface PrimitiveBreakingState extends BaseServiceState {
	block: Block | null
}

interface BreakingOptions {
	block: Block
}

export const primitiveBreaking = createStatefulService<
	PrimitiveBreakingState,
	BreakingOptions
>({
	name: 'primitiveBreaking',
	initialState: {
		block: null
	},

	onStart: async ({ sendBack, setState, input, bot, abortSignal }) => {
		const { block } = input

		if (!block) {
			sendBack({ type: 'BREAKING_FAILED' })
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

			console.log(`⛏️ Breaking block: ${block.name}`)
			await bot.dig(block)
			console.log(`✅ BROKEN block: ${block.name}`)

			sendBack({ type: 'BROKEN' })
		} catch (error) {
			if (abortSignal.aborted) {
				console.log('⚠️ primitiveBreaking aborted')
				return
			}
			
			console.error('❌ primitiveBreaking error:', error)
			sendBack({ type: 'BREAKING_FAILED' })
		}
	}
})
