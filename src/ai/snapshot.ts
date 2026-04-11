import type { WindowSession } from '@/ai/runtime/window.js'

const DEFAULT_ERROR_HISTORY_LIMIT = 3

export type VecLike = {
	x: number
	y: number
	z: number
}

export type SnapshotBot = {
	health: number
	food: number
	oxygenLevel: number
	entity: {
		position: VecLike
	}
	game?: {
		dimension?: string
	}
}

export type ActiveWindowSessionState = 'open' | 'close_failed' | null

interface BuildSnapshotInput {
	bot: SnapshotBot
	lastAction: string | null
	lastResult: 'SUCCESS' | 'FAILED' | null
	lastReason: string | null
	errorHistory: string[]
	activeWindowSession: WindowSession | null
	activeWindowSessionState: ActiveWindowSessionState
}

interface ActiveWindowSessionSummary {
	isOpen: boolean
	windowKind: string | null
	blockName: string | null
	position: VecLike | null
	closeFailed: boolean
}

const formatPosition = (position: VecLike | null | undefined): string =>
	position ? `${position.x},${position.y},${position.z}` : '-'

const summarizeActiveWindowSession = (
	session: WindowSession | null | undefined,
	state: ActiveWindowSessionState | undefined
): ActiveWindowSessionSummary => ({
	isOpen: Boolean(session),
	windowKind: session?.kind ?? null,
	blockName: session?.blockName ?? null,
	position: session?.position ?? null,
	closeFailed: state === 'close_failed'
})

export const buildSnapshot = (input: BuildSnapshotInput): string => {
	const { bot } = input
	const activeWindowSummary = summarizeActiveWindowSession(
		input.activeWindowSession,
		input.activeWindowSessionState
	)
	const cappedErrorHistory = input.errorHistory.slice(
		0,
		DEFAULT_ERROR_HISTORY_LIMIT
	)
	const errorLine = cappedErrorHistory.length
		? cappedErrorHistory.join(' | ')
		: '-'

	return [
		'STATUS',
		`health: ${bot.health}/20`,
		`food: ${bot.food}/20`,
		`oxygen: ${bot.oxygenLevel}/20`,
		`position: ${formatPosition(bot.entity.position)}`,
		`dimension: ${bot.game?.dimension ?? 'unknown'}`,
		'',
		'ACTIVE_WINDOW_SESSION',
		`is_open: ${activeWindowSummary.isOpen ? 'true' : 'false'}`,
		`window_kind: ${activeWindowSummary.windowKind ?? '-'}`,
		`block_name: ${activeWindowSummary.blockName ?? '-'}`,
		`position: ${formatPosition(activeWindowSummary.position)}`,
		`close_failed: ${activeWindowSummary.closeFailed ? 'true' : 'false'}`,
		'',
		'FEEDBACK_ERRORS',
		`last_action: ${input.lastAction ?? '-'}`,
		`last_result: ${input.lastResult ?? '-'}`,
		`last_reason: ${input.lastReason ?? '-'}`,
		`error_history: ${errorLine}`
	].join('\n')
}
