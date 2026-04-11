import {
	closeWindowSessionSafely,
	describeWindowSession,
	openWindowSession
} from '@/ai/runtime/window.js'

import type {
	InlineToolExecutionContext,
	InlineToolExecutionResult
} from '../inlineExecutor.js'
import { positionsEqual, toVec3, tryToPosition } from '../shared.js'

export const executeWindowTool = async (
	args: Record<string, unknown>,
	context: InlineToolExecutionContext
): Promise<InlineToolExecutionResult> => {
	const requestedPosition = tryToPosition(args.position)
	const activeSession = context.activeWindowSession ?? null
	const activeSessionState = context.activeWindowSessionState ?? null
	const isStaleActiveSession = activeSessionState === 'close_failed'
	const canReuseActiveSession =
		Boolean(activeSession) &&
		(!requestedPosition ||
			positionsEqual(activeSession?.position, requestedPosition))

	if (isStaleActiveSession) {
		return {
			ok: false,
			output: {
				reason:
					'Active window session is stale (previous close failed). Resolve with close_window before inspect_window.'
			}
		}
	}

	if (
		activeSession &&
		requestedPosition &&
		!positionsEqual(activeSession.position, requestedPosition)
	) {
		return {
			ok: false,
			output: {
				reason:
					'Active window session is already open at a different position. Close it with close_window before inspect_window at another location.'
			}
		}
	}

	if (activeSession && canReuseActiveSession) {
		return {
			ok: true,
			output: {
				reusedActiveSession: true,
				kind: activeSession.kind,
				blockName: activeSession.blockName,
				window: describeWindowSession(activeSession),
				closeFailed: false
			}
		}
	}

	if (!requestedPosition) {
		return {
			ok: false,
			output: {
				reason:
					'No active window session. Provide position to inspect nearby window block.'
			}
		}
	}

	const block = context.bot.blockAt(toVec3(requestedPosition))
	if (!block) {
		return { ok: false, output: { reason: 'Window block not found' } }
	}

	const distance = context.bot.entity.position.distanceTo(block.position)
	if (distance > 4) {
		return {
			ok: false,
			output: {
				reason: `Window is too far away (${distance.toFixed(1)}m)`
			}
		}
	}

	let session: Awaited<ReturnType<typeof openWindowSession>> | null = null

	try {
		session = await openWindowSession(context.bot, block, requestedPosition)

		const window = describeWindowSession(session)
		const closeResult = closeWindowSessionSafely(context.bot, session)
		if (!closeResult.ok) {
			return {
				ok: false,
				output: {
					reason:
						'Failed to close temporary window session after inspect_window; runtime window state is untrusted.',
					close: closeResult
				}
			}
		}

		return {
			ok: true,
			output: {
				reusedActiveSession: false,
				blockName: block.name,
				kind: session.kind,
				window,
				close: closeResult
			}
		}
	} catch (error) {
		if (session) {
			closeWindowSessionSafely(context.bot, session)
		}

		return {
			ok: false,
			output: {
				reason:
					error instanceof Error ? error.message : 'Unsupported window block'
			}
		}
	}
}
