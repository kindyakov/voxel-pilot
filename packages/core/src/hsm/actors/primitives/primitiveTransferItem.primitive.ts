import { createStatefulService } from '@/hsm/helpers/createStatefulService.js'

import type { WindowTransferRequest } from '@/ai/runtime/window.js'

export const primitiveTransferItem = createStatefulService<
	{ isActive: boolean },
	WindowTransferRequest
>({
	name: 'primitiveTransferItem',
	onStart: async ({ context, input, sendBack, abortSignal }) => {
		try {
			if (!context.windows) throw new Error('Window runtime is unavailable')
			const transferred = await context.windows.transfer(input, abortSignal)
			sendBack({ type: 'WINDOW_ITEM_TRANSFERRED', transferred })
		} catch (error) {
			if (!abortSignal.aborted)
				sendBack({
					type: 'WINDOW_TRANSFER_FAILED',
					reason: error instanceof Error ? error.message : String(error)
				})
		}
	}
})
