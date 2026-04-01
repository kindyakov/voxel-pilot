import type { Bot } from '@/types'

export const hasMovementController = (bot: Bot | null | undefined): boolean => {
	return (
		Boolean(bot?.movement?.heuristic) &&
		typeof bot?.movement?.setGoal === 'function' &&
		typeof bot?.movement?.getYaw === 'function' &&
		typeof bot?.movement?.steer === 'function'
	)
}
