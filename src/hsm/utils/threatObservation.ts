import { Vec3 } from 'vec3'

import type { Entity } from '@/types'
import type { Bot } from '@/types'

import type { ThreatObservation } from '@/hsm/context'

import { readCreeperSignals } from '@/utils/combat/mobSignals'
import type { ThreatKind } from '@/utils/combat/selfDefense'

/** Retain lost threats, but clear visibly safe entities in the current scan. */
export const observeThreats = (
	previous: ThreatObservation[],
	observedEntities: Entity[],
	position: Vec3,
	now: number,
	retentionMs: number,
	assess: (entity: Entity) => ThreatKind | null,
	bot: Bot
) => {
	const byId = new Map<number, ThreatObservation>()
	for (const threat of previous) {
		if (now - threat.lastObservedAt < retentionMs) {
			byId.set(threat.entityId, {
				...threat,
				distance: position.distanceTo(threat.position),
				observed: false
			})
		}
	}
	for (const entity of observedEntities) {
		if (!entity.position || entity.isValid === false) continue
		const kind = assess(entity)
		if (!kind) {
			byId.delete(entity.id)
			continue
		}
		const signals =
			entity.name === 'creeper' ? readCreeperSignals(bot, entity) : null
		const creeper = signals
			? {
					...signals,
					disengaged:
						byId.get(entity.id)?.creeper?.disengaged === true ||
						signals.swelling !== false ||
						signals.ignited !== false
				}
			: null
		byId.set(entity.id, {
			creeper,
			kind,
			entityId: entity.id,
			position: new Vec3(
				entity.position.x,
				entity.position.y,
				entity.position.z
			),
			distance: position.distanceTo(entity.position),
			lastObservedAt: now,
			observed: true
		})
	}
	const threats = [...byId.values()].sort(
		(a, b) => a.distance - b.distance || a.entityId - b.entityId
	)
	return { threats, nearestThreat: threats[0] ?? null }
}
