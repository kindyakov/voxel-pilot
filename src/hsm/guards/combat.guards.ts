import type { MachineContext } from '@/hsm/context'
import type { MachineEvent } from '@/hsm/types'
import type { MachineGuardParams } from '@/hsm/types'

import {
	approachIsBlocked,
	canResumeApproach
} from '@/utils/combat/approachPolicy'
import {
	getMeleeExitRange,
	hasRangedLoadout,
	resolveCombatTarget
} from '@/utils/combat/combatRange'
import { canSeeEnemy } from '@/utils/combat/enemyVisibility'
import {
	forbidsMelee,
	hasCombatWeapon,
	isDefensiveCandidate,
	requiresAvoidance
} from '@/utils/combat/selfDefense'
import { isFinitePosition } from '@/utils/minecraft/spatial'

const canUseRanged = ({ context }: MachineGuardParams): boolean => {
	const target = resolveCombatTarget(context)
	if (
		context.threatObservationProblem !== null ||
		!target.entity ||
		target.distance > context.preferences.rangedAttackRange ||
		requiresAvoidance(context) ||
		(forbidsMelee(context) &&
			target.distance <= context.preferences.creeperDangerDistance)
	)
		return false
	if (!hasRangedLoadout(context)) return false

	// Проверка видимости врага (raycast)
	if (!context.bot || !context.combatTarget?.entity) return false

	return canSeeEnemy(context.bot, context.combatTarget.entity)
}

const isEnemyInMeleeRange = ({ context }: MachineGuardParams): boolean => {
	return (
		resolveCombatTarget(context).distance <= context.preferences.enemyMeleeRange
	)
}

const canSkirmishRanged = ({ context, event }: MachineGuardParams): boolean => {
	return (
		context.combatTarget.entity !== null &&
		resolveCombatTarget(context).distance >
			context.preferences.enemyMeleeRange &&
		canUseRanged({ context, event })
	)
}

export const isCombatTargetUpdateEvent = (
	event: MachineEvent
): event is Extract<MachineEvent, { type: 'UPDATE_COMBAT_TARGET' }> =>
	event.type === 'UPDATE_COMBAT_TARGET'

export const eventCanAutoEnterCombat = ({
	context,
	event
}: {
	context: MachineContext
	event: MachineEvent
}) =>
	isCombatTargetUpdateEvent(event) &&
	context.preferences.autoDefend &&
	!context.combatStopRequested &&
	hasCombatWeapon(context) &&
	isDefensiveCandidate(context, event.combatTarget.entity)

export const eventEnemyInMeleeRange = ({
	event,
	context
}: {
	context: MachineContext
	event: MachineEvent
}) =>
	isCombatTargetUpdateEvent(event) &&
	Boolean(event.combatTarget.entity) &&
	resolveCombatTarget(context, event.combatTarget.entity).distance <=
		context.preferences.enemyMeleeRange

export const eventCanSkirmishRanged = ({
	context,
	event
}: MachineGuardParams) =>
	isCombatTargetUpdateEvent(event) &&
	canSkirmishRanged({
		event,
		context: { ...context, combatTarget: event.combatTarget }
	})

export const eventCanSkirmishRangedFromMelee = ({
	event,
	context
}: {
	context: MachineContext
	event: MachineEvent
}) => {
	if (
		!isCombatTargetUpdateEvent(event) ||
		!event.combatTarget.entity ||
		resolveCombatTarget(context, event.combatTarget.entity).distance <=
			getMeleeExitRange(context)
	) {
		return false
	}

	return eventCanSkirmishRanged({ event, context })
}

const canMelee = ({ context }: MachineGuardParams) =>
	context.combatTarget.entity !== null &&
	context.threatObservationProblem === null &&
	isFinitePosition(context.bot?.entity?.position) &&
	isFinitePosition(context.combatTarget.entity.position) &&
	!requiresAvoidance(context) &&
	!forbidsMelee(context) &&
	!approachIsBlocked(context) &&
	Boolean(context.bot?.utils.getMeleeWeapon())

export default {
	canAttack: (params: MachineGuardParams) =>
		canMelee(params) || canSkirmishRanged(params),
	canMelee,
	canResumeApproach: ({ context }: MachineGuardParams) =>
		context.threatObservationProblem === null &&
		isFinitePosition(context.bot?.entity?.position) &&
		canResumeApproach(context) &&
		!requiresAvoidance(context) &&
		!forbidsMelee(context) &&
		Boolean(context.bot?.utils.getMeleeWeapon()),
	canSkirmishRanged,
	isEnemyInMeleeRange
}
