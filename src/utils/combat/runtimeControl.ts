import type { Bot } from '@/types'

export const stopMeleeAttack = (
	bot: Bot,
	reason: string,
	log?: (event: string, payload: Record<string, unknown>) => void
) => {
	if (typeof (bot as any).pvp?.forceStop === 'function') {
		;(bot as any).pvp.forceStop()
		log?.('melee_force_stop', { reason })
		return
	}

	const stopResult = (bot as any).pvp?.stop?.()
	if (stopResult instanceof Promise) {
		void stopResult.catch((error: unknown) => {
			console.error(
				'[COMBAT] melee_stop_failed',
				error instanceof Error ? error.message : String(error)
			)
		})
	}

	log?.('melee_stop', { reason })
}

export const stopRangedAttack = (
	bot: Bot,
	reason: string,
	log?: (event: string, payload: Record<string, unknown>) => void
) => {
	;(bot as any).hawkEye?.stop?.()
	log?.('ranged_stop', { reason })
}

export const clearMicroMovement = (bot: Bot) => {
	if (typeof bot.setControlState !== 'function') {
		return
	}

	bot.setControlState('forward', false)
	bot.setControlState('back', false)
	bot.setControlState('left', false)
	bot.setControlState('right', false)
	bot.setControlState('sprint', false)
	bot.setControlState('jump', false)
}

export const enableMicroMovement = (bot: Bot) => {
	if (typeof bot.setControlState !== 'function') {
		return
	}

	bot.setControlState('forward', true)
	bot.setControlState('back', false)
	bot.setControlState('left', false)
	bot.setControlState('right', false)
	bot.setControlState('sprint', true)
	bot.setControlState('jump', true)
}

export const stopPathfinderMovement = (bot: Bot) => {
	;(bot as any).pathfinder?.setGoal?.(null)
}
