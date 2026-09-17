import { Vec3 } from 'vec3'
import { fromCallback } from 'xstate'

import type { Block, Bot, Entity } from '@/types/index.js'

import type { MachineEvent } from '@/hsm/types.js'

import { hasPassabilityChanged } from '@/utils/combat/passability.js'

/** Mineflayer normalizes version-specific damage packets; a source is optional. */
export const worldObservation = fromCallback<MachineEvent, { bot: Bot }>(
	({ input: { bot }, sendBack }) => {
		const onHurt = (entity?: Entity, source?: Entity) => {
			if (!entity || entity.id !== bot.entity?.id) return
			sendBack({
				type: 'DAMAGE_OBSERVED',
				sourceId: source?.id ?? null,
				sourcePosition: source?.position
					? new Vec3(source.position.x, source.position.y, source.position.z)
					: null
			})
		}
		bot.on('entityHurt', onHurt)
		const onBlockUpdate = (before: Block | null, after: Block | null) => {
			if (after && hasPassabilityChanged(before, after))
				sendBack({ type: 'PASSABILITY_CHANGED', position: after.position })
		}
		bot.on('blockUpdate', onBlockUpdate)
		return () => {
			bot.off('entityHurt', onHurt)
			bot.off('blockUpdate', onBlockUpdate)
		}
	}
)
