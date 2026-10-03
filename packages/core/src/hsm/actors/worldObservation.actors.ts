import type { Block, Bot } from '@/types/index.js'
import { fromCallback } from 'xstate'

import type { MachineEvent } from '@/hsm/types.js'

import { observeNativeDamage } from '@/modules/connection/nativeDamage.js'

import { hasPassabilityChanged } from '@/utils/combat/passability.js'

/** Session-owned native facts preserve source evidence that entityHurt discards. */
export const worldObservation = fromCallback<MachineEvent, { bot: Bot }>(
	({ input: { bot }, sendBack }) => {
		const stopDamage = observeNativeDamage(bot, damage =>
			sendBack({ type: 'DAMAGE_OBSERVED', ...damage })
		)
		const onBlockUpdate = (before: Block | null, after: Block | null) => {
			if (after && hasPassabilityChanged(before, after))
				sendBack({ type: 'PASSABILITY_CHANGED', position: after.position })
		}
		bot.on('blockUpdate', onBlockUpdate)
		return () => {
			stopDamage()
			bot.off('blockUpdate', onBlockUpdate)
		}
	}
)
