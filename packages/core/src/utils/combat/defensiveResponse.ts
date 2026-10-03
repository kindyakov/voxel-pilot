import type { Entity } from '@/types/index.js'

import type { MachineContext } from '@/hsm/context.js'
import combatGuards from '@/hsm/guards/combat.guards.js'
import { hasFreshThreatObservation } from '@/hsm/guards/survival.guards.js'

import { isFinitePosition } from '@/utils/minecraft/spatial.js'

import { canSeeEnemy } from './enemyVisibility.js'
import {
	isDefensiveCandidate,
	requiresAvoidance,
	selectCombatTarget
} from './selfDefense.js'

export const refreshAttackContacts = (
	context: MachineContext,
	entities: Entity[]
) =>
	Object.fromEntries(
		Object.entries(context.attackContacts).flatMap(([id, contact]) => {
			const entity = entities.find(
				entity =>
					entity.id === Number(id) &&
					(!contact.entity || contact.entity === entity) &&
					entity.isValid !== false &&
					!context.deadEntities.has(entity) &&
					isFinitePosition(entity.position)
			)
			if (entity)
				return [
					[
						id,
						{
							...contact,
							entity,
							position: entity.position.clone(),
							lastObservedAt: Date.now()
						}
					]
				]
			return Date.now() - contact.lastObservedAt <
				context.preferences.threatRetentionMs
				? [[id, contact]]
				: []
		})
	)

/** Preparation of an available weapon counts as a response; an equipped empty hand is irrelevant. */
export const hasAvailableDefense = (
	context: MachineContext,
	closeOnly = false
) => {
	const target = selectCombatTarget(context)
	if (!target.entity || !context.bot || requiresAvoidance(context)) return false
	const targetId = target.entity.id
	const selected = { ...context, combatTarget: target }
	if (
		closeOnly &&
		(target.distance > context.bot.pvp.attackRange ||
			!canSeeEnemy(context.bot, target.entity) ||
			context.threats.some(
				threat =>
					threat.observed &&
					threat.entityId !== targetId &&
					threat.kind !== 'hostile' &&
					threat.distance <= context.preferences.selfDefenseDistance
			))
	)
		return false
	return combatGuards.canAttack({
		context: selected,
		event: { type: 'APPROACH_SAMPLE' }
	})
}

/** Recently continuing fire escalates an exhausted/unanswerable response, without a total pursuit deadline. */
export const needsDefensiveRelocation = (context: MachineContext) => {
	if (context.defensiveRelocation) return !canAnswerDefensiveDamage(context)
	if (
		context.lastDamage.sequence <= context.defensiveDamageHandled ||
		Date.now() - context.lastDamage.observedAt >=
			context.preferences.aggressionRetentionMs
	)
		return false
	if (
		context.lastDamage.sourceId !== null &&
		!hasFreshThreatObservation(context)
	)
		return false
	return (
		(context.lastDamage.sourceId === null ||
			Boolean(context.attackContacts[context.lastDamage.sourceId])) &&
		!canAnswerDefensiveDamage(context)
	)
}

/** A new usable response returns to combat, retaining any unresolved relocation obligation. */
export const canAnswerDefensiveDamage = (context: MachineContext) => {
	const sourceId =
		context.defensiveRelocation?.sourceId ?? context.lastDamage.sourceId
	if (sourceId === null) return hasAvailableDefense(context, true)
	const contact = context.attackContacts[sourceId]
	if (!contact?.entity || !isDefensiveCandidate(context, contact.entity))
		return false
	const selected = selectCombatTarget(context).entity
	if (
		contact?.ranged &&
		(!contact.entity ||
			!selected ||
			context.attackContacts[selected.id]?.ranged !== true ||
			context.attackContacts[selected.id]?.entity !== selected)
	)
		return false
	return hasAvailableDefense(context)
}

export const defensiveRelocationSafe = (context: MachineContext) => {
	const obligation = context.defensiveRelocation
	if (
		!obligation ||
		!context.bot ||
		!obligation.from ||
		!isFinitePosition(obligation.from) ||
		!hasFreshThreatObservation(context) ||
		context.threatObservationAt! < context.lastDamage.observedAt ||
		Date.now() - context.lastDamage.observedAt <
			context.preferences.defensiveQuietMs ||
		requiresAvoidance(context) ||
		Object.keys(context.attackContacts).length > 0 ||
		context.threats.some(
			threat => threat.distance <= context.preferences.selfDefenseDistance
		)
	)
		return false
	return (
		obligation.sourceId !== null ||
		Math.hypot(
			context.bot.entity.position.x - obligation.from.x,
			context.bot.entity.position.z - obligation.from.z
		) >=
			context.preferences.fleeTargetDistance - 1
	)
}

export const hasDangerousAttackContact = (context: MachineContext) =>
	Object.keys(context.attackContacts).length > 0
