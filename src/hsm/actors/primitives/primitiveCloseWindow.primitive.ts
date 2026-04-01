import { closeWindowSession, type WindowSession } from '@/ai/runtime/window.js'
import { createStatefulService } from '@/hsm/helpers/createStatefulService'

interface CloseWindowState {
	isActive: boolean
	[key: string]: unknown
	closed: boolean
}

export const primitiveCloseWindow = createStatefulService<CloseWindowState, {}>({
	name: 'primitiveCloseWindow',
	initialState: {
		isActive: true,
		closed: false
	},

	onStart: async ({ bot, context, sendBack, setState, abortSignal }) => {
		const session = context.activeWindowSession

		if (!session) {
			sendBack({
				type: 'WINDOW_CLOSE_FAILED',
				reason: 'No active window session'
			})
			return
		}

		if (abortSignal.aborted) {
			return
		}

		try {
			closeWindowSession(bot, session as WindowSession)

			if (abortSignal.aborted) {
				return
			}

			setState({ closed: true })
			sendBack({
				type: 'WINDOW_CLOSED'
			})
		} catch (error) {
			sendBack({
				type: 'WINDOW_CLOSE_FAILED',
				reason: error instanceof Error ? error.message : 'Unknown error'
			})
		}
	}
})
