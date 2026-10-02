import type { Entity } from '@/types/index.js'

import type { MachineContext } from '@/hsm/context.js'

import { isFinitePosition } from '@/utils/minecraft/spatial.js'

/** Actors and guards must use the same live geometry, not a cached scan distance. */
export const resolveCombatTarget = (
	context: MachineContext,
	entity: Entity | null = context.combatTarget.entity
): MachineContext['combatTarget'] => {
	const position = context.bot?.entity?.position
	if (
		!entity ||
		entity.isValid === false ||
		context.deadEntities.has(entity) ||
		!position ||
		!isFinitePosition(position) ||
		!isFinitePosition(entity.position)
	)
		return { entity: null, distance: Infinity }
	return { entity, distance: position.distanceTo(entity.position) }
}

export const getMeleeExitRange = (
	context: Pick<MachineContext, 'preferences'>
) => context.preferences.enemyMeleeRange + 1.5

export const hasRangedLoadout = (context: MachineContext) =>
	!context.rangedUnavailable &&
	Boolean(context.bot?.utils.getRangeWeapon() && context.bot.utils.getArrow())
