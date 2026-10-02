import type { MemoryPosition } from '@/core/memory/types.js'

import { createStatefulService } from '@/hsm/helpers/createStatefulService.js'

export const primitiveOpenWindow = createStatefulService<
	{ isActive: boolean },
	{ position: MemoryPosition | null }
>({
	name: 'primitiveOpenWindow',
	onStart: async ({ context, input, sendBack, abortSignal }) => {
		try {
			if (!input.position) throw new Error('No position provided')
			if (!context.windows) throw new Error('Window runtime is unavailable')
			await context.windows.open(input.position, abortSignal)
			sendBack({ type: 'WINDOW_OPENED' })
		} catch (error) {
			if (!abortSignal.aborted)
				sendBack({
					type: 'WINDOW_OPEN_FAILED',
					reason: error instanceof Error ? error.message : String(error)
				})
		}
	}
})
