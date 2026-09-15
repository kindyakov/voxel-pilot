import type { Entity } from '@/types'

import type { MachineContext } from '@/hsm/context'

import { isFinitePosition } from '@/utils/minecraft/spatial'

import { hasRangedLoadout } from './combatRange'
import { canSeeEnemy } from './enemyVisibility'
import { mobPolicyOverrides, vanillaFollowRange } from './mobProfiles'
import { readMobMetadata } from './mobSignals'

export type ThreatKind = 'hostile' | 'uncertain' | 'avoid'

interface MobAssessment {
	kind: ThreatKind | null
	reason: string
}

const assessMobWithReason = (
	context: MachineContext,
	entity: Entity
): MobAssessment => {
	if (context.deadEntities.has(entity))
		return { kind: null, reason: 'entity_dead' }
	const bot = context.bot
	if (!bot) return { kind: 'uncertain', reason: 'bot_unavailable' }
	if (entity.type === 'player') return { kind: null, reason: 'pvp_disabled' }
	const registered = entity.name
		? bot.registry.entitiesByName[entity.name]
		: undefined
	// Runtime representations (notably XP `orb`) can differ from registry types.
	if (
		entity.name === 'armor_stand' ||
		entity.type === 'orb' ||
		entity.type === 'other' ||
		entity.type === 'projectile' ||
		registered?.type === 'other' ||
		registered?.type === 'projectile'
	)
		return { kind: null, reason: 'not_a_combat_mob' }
	const policy =
		entity.name && Object.hasOwn(mobPolicyOverrides, entity.name)
			? mobPolicyOverrides[entity.name]
			: undefined
	if (policy === 'avoid') return { kind: 'avoid', reason: 'avoid_only_species' }
	if (!isFinitePosition(entity.position))
		return { kind: 'uncertain', reason: 'invalid_entity_position' }
	const attackedAt = context.aggressionByEntity[entity.id]
	if (
		attackedAt !== undefined &&
		Date.now() - attackedAt < context.preferences.aggressionRetentionMs
	)
		return { kind: 'hostile', reason: 'confirmed_attack_on_bot' }
	if (policy === 'slime_size') {
		const size = readMobMetadata(bot, entity, 'size')
		if (typeof size !== 'number' || !Number.isInteger(size) || size < 1)
			return { kind: 'uncertain', reason: 'slime_size_unknown' }
		return size === 1
			? { kind: null, reason: 'tiny_slime' }
			: { kind: 'hostile', reason: 'damaging_slime' }
	}
	if (policy === 'spider_light') {
		if (bot.game?.dimension !== 'overworld')
			return { kind: 'uncertain', reason: 'ambient_light_unknown' }
		const block = bot.blockAt(entity.position.offset(0, 0.65, 0))
		// Basic policy uses Mineflayer's day flag and local light, not a solar model.
		if (
			!block ||
			!Number.isInteger(block.light) ||
			block.light < 0 ||
			block.light > 15 ||
			!Number.isInteger(block.skyLight) ||
			block.skyLight < 0 ||
			block.skyLight > 15
		)
			return { kind: 'uncertain', reason: 'spider_light_unknown' }
		if (block.light >= 12) return { kind: null, reason: 'spider_bright_light' }
		if (bot.time?.isDay === true && block.skyLight >= 12)
			return { kind: null, reason: 'spider_daylight' }
		return bot.time?.isDay === false || block.skyLight < 12
			? { kind: 'hostile', reason: 'spider_darkness' }
			: { kind: 'uncertain', reason: 'spider_sky_light_uncertain' }
	}
	if (policy === 'enderman_anger') {
		const angry = readMobMetadata(bot, entity, 'creepy')
		const stared = readMobMetadata(bot, entity, 'stared_at')
		return angry === false && stared === false
			? { kind: null, reason: 'enderman_unprovoked' }
			: { kind: 'uncertain', reason: 'enderman_target_unknown' }
	}
	if (policy === 'neutral_anger') {
		const anger = readMobMetadata(bot, entity, 'remaining_anger_time')
		return anger === 0
			? { kind: null, reason: 'neutral_unprovoked' }
			: { kind: 'uncertain', reason: 'neutral_aggression_unknown' }
	}
	if (policy === 'rabbit_variant') {
		const variant = readMobMetadata(bot, entity, 'type')
		if (variant === 99) return { kind: 'hostile', reason: 'killer_bunny' }
		return typeof variant === 'number' &&
			Number.isInteger(variant) &&
			variant >= 0 &&
			variant <= 5
			? { kind: null, reason: 'passive_rabbit_variant' }
			: { kind: 'uncertain', reason: 'rabbit_variant_unknown' }
	}
	if (policy === 'passive')
		return { kind: null, reason: 'passive_category_exception' }
	if (policy === 'uncertain')
		return { kind: 'uncertain', reason: 'aggression_conditions_unknown' }
	// `type` describes representation (e.g. hoglin=animal, magma_cube=mob).
	// Use the connected registry's category only after aggression/variant rules.
	const category = registered?.category
	if (category === 'Hostile mobs')
		return { kind: 'hostile', reason: 'hostile_category' }
	if (category === 'Passive mobs')
		return { kind: null, reason: 'passive_category' }
	return { kind: 'uncertain', reason: 'species_unknown' }
}

export const assessMob = (
	context: MachineContext,
	entity: Entity
): ThreatKind | null => assessMobWithReason(context, entity).kind

export const nearestDangerousCreeper = (
	context: MachineContext,
	distance = context.preferences.creeperDangerDistance
) =>
	context.threats.find(
		threat =>
			threat.creeper &&
			(threat.creeper.swelling !== false || threat.creeper.ignited !== false) &&
			threat.distance <= distance
	)

export const nearestRetreatCreeper = (context: MachineContext) =>
	nearestDangerousCreeper(
		context,
		Math.max(
			context.preferences.creeperDangerDistance,
			context.preferences.creeperRetreatDistance
		)
	)

export const requiresAvoidance = (context: MachineContext) =>
	nearestDangerousCreeper(context) !== undefined

export const hasCombatWeapon = (context: MachineContext) =>
	Boolean(context.bot?.utils.getMeleeWeapon()) ||
	Boolean(context.bot?.utils.getRangeWeapon() && context.bot.utils.getArrow())

export const forbidsMelee = (context: MachineContext) =>
	context.threats.some(
		threat =>
			threat.entityId === context.combatTarget.entity?.id &&
			threat.creeper?.disengaged
	)

const defensiveCandidateReason = (
	context: MachineContext,
	entity: Entity | null
) => {
	if (
		context.health <= 0 ||
		context.threatObservationProblem !== null ||
		!context.bot ||
		!isFinitePosition(context.bot.entity?.position) ||
		!entity?.position ||
		!isFinitePosition(entity.position) ||
		entity.isValid === false
	)
		return 'invalid_or_inactive_target'
	const assessment = assessMobWithReason(context, entity)
	if (assessment.kind !== 'hostile') return assessment.reason
	const distance = context.bot.entity.position.distanceTo(entity.position)
	const continuingEncounter =
		entity.id === context.combatTarget.entity?.id ||
		context.threats.some(
			threat => threat.entityId === entity.id && threat.creeper?.disengaged
		)
	// Ranged defense has its own envelope; mob follow ranges are not bow ranges.
	const range = hasRangedLoadout(context)
		? context.preferences.rangedAttackRange
		: continuingEncounter
			? context.preferences.maxDistToEnemy
			: Math.min(
					context.preferences.selfDefenseDistance,
					vanillaFollowRange[entity.name ?? ''] ??
						context.preferences.selfDefenseDistance
				)
	if (!(distance <= range)) return 'outside_engagement_range'
	if (
		context.threats.some(
			threat => threat.entityId === entity.id && threat.creeper?.disengaged
		) &&
		(context.rangedUnavailable ||
			!context.bot.utils.getRangeWeapon() ||
			!context.bot.utils.getArrow() ||
			distance <= context.preferences.creeperDangerDistance)
	)
		return 'creeper_melee_disengaged'
	return canSeeEnemy(context.bot, entity) ? 'eligible' : 'no_line_of_sight'
}

export const selectCombatDecision = (context: MachineContext) => {
	const position = context.bot?.entity?.position
	if (!position || !isFinitePosition(position))
		return { target: { entity: null, distance: Infinity }, candidates: [] }
	const evaluated = context.enemies.map(entity => ({
		entity,
		reason: defensiveCandidateReason(context, entity)
	}))
	const candidates = evaluated
		.filter(candidate => candidate.reason === 'eligible')
		.map(candidate => candidate.entity)
	const entity =
		candidates.sort(
			(a, b) =>
				position.distanceTo(a.position) - position.distanceTo(b.position) ||
				a.id - b.id
		)[0] ?? null
	return {
		target: {
			entity,
			distance: entity ? position.distanceTo(entity.position) : Infinity
		},
		candidates: evaluated.map(candidate => ({
			id: candidate.entity.id,
			name: candidate.entity.name ?? null,
			distance: candidate.entity.position
				? position.distanceTo(candidate.entity.position)
				: Infinity,
			reason: candidate.reason
		}))
	}
}

export const isDefensiveCandidate = (
	context: MachineContext,
	entity: Entity | null
) => defensiveCandidateReason(context, entity) === 'eligible'

export const selectCombatTarget = (
	context: MachineContext
): MachineContext['combatTarget'] => selectCombatDecision(context).target
