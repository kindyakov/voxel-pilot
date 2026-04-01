import {
	transferWindowItem,
	type WindowTransferRequest,
	type WindowTransferResult
} from '@/ai/runtime/window.js'
import { createStatefulService } from '@/hsm/helpers/createStatefulService'

interface TransferItemState {
	isActive: boolean
	[key: string]: unknown
	transferred: WindowTransferResult | null
}

export const primitiveTransferItem = createStatefulService<
	TransferItemState,
	WindowTransferRequest
>({
	name: 'primitiveTransferItem',
	initialState: {
		isActive: true,
		transferred: null
	},

	onStart: async ({ bot, context, input, sendBack, setState, abortSignal }) => {
		const session = context.activeWindowSession

		if (!session) {
			sendBack({
				type: 'WINDOW_TRANSFER_FAILED',
				reason: 'No active window session'
			})
			return
		}

		if (context.activeWindowSessionState === 'close_failed') {
			sendBack({
				type: 'WINDOW_TRANSFER_FAILED',
				reason: 'Active window session close is unconfirmed'
			})
			return
		}

		if (abortSignal.aborted) {
			return
		}

		try {
			const transferred = await transferWindowItem(bot, session, input)

			if (abortSignal.aborted) {
				return
			}

			setState({ transferred })
			sendBack({
				type: 'WINDOW_ITEM_TRANSFERRED',
				transferred
			})
		} catch (error) {
			sendBack({
				type: 'WINDOW_TRANSFER_FAILED',
				reason: error instanceof Error ? error.message : 'Unknown error'
			})
		}
	}
})
