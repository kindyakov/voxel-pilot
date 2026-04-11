import {
	type WindowSession,
	closeWindowSession,
	closeWindowSessionSafely,
	openWindowSession
} from '@/ai/runtime/window.js'

import type { MemoryPosition } from '@/core/memory/types.js'

import { createStatefulService } from '@/hsm/helpers/createStatefulService'

interface OpenWindowState {
	isActive: boolean
	[key: string]: unknown
	windowSession: WindowSession | null
}

interface OpenWindowOptions {
	position: MemoryPosition
}

export const primitiveOpenWindow = createStatefulService<
	OpenWindowState,
	OpenWindowOptions
>({
	name: 'primitiveOpenWindow',
	initialState: {
		isActive: true,
		windowSession: null
	},

	onStart: async ({ bot, context, input, sendBack, setState, abortSignal }) => {
		const { position } = input

		if (context.activeWindowSession) {
			sendBack({
				type: 'WINDOW_OPEN_FAILED',
				reason: 'Active window session already exists'
			})
			return
		}

		if (!position) {
			sendBack({
				type: 'WINDOW_OPEN_FAILED',
				reason: 'No position provided'
			})
			return
		}

		if (abortSignal.aborted) {
			return
		}

		const block = bot.blockAt(position)
		if (!block) {
			sendBack({
				type: 'WINDOW_OPEN_FAILED',
				reason: 'Window block not found'
			})
			return
		}

		try {
			const session = await openWindowSession(bot, block, position)

			if (abortSignal.aborted) {
				const closeResult = closeWindowSessionSafely(bot, session)
				const dispatch = (bot as any).hsm?.send?.bind((bot as any).hsm)

				if (!closeResult.ok) {
					;(dispatch ?? sendBack)({
						type: 'WINDOW_OPENED',
						session
					})
					;(dispatch ?? sendBack)({
						type: 'WINDOW_CLOSE_FAILED',
						reason: closeResult.reason ?? 'Unknown window close error'
					})
				}

				return
			}

			setState({ windowSession: session })
			sendBack({
				type: 'WINDOW_OPENED',
				session
			})
		} catch (error) {
			sendBack({
				type: 'WINDOW_OPEN_FAILED',
				reason: error instanceof Error ? error.message : 'Unknown error'
			})
		}
	},

	onCleanup: ({ state }) => {
		state.windowSession = null
	}
})
