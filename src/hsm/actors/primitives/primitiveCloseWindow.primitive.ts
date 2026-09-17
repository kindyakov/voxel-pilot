import { createStatefulService } from '@/hsm/helpers/createStatefulService.js'

export const primitiveCloseWindow = createStatefulService({
	name: 'primitiveCloseWindow',
	onStart: ({ context, sendBack, abortSignal }) => {
		if (abortSignal.aborted) return
		if (!context.windows) {
			sendBack({
				type: 'WINDOW_CLOSE_FAILED',
				reason: 'Window runtime is unavailable'
			})
			return
		}
		const result = context.windows.close()
		sendBack(
			result.ok
				? { type: 'WINDOW_CLOSED' }
				: {
						type: 'WINDOW_CLOSE_FAILED',
						reason: result.reason ?? 'Window close is unconfirmed'
					}
		)
	}
})
