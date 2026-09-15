import type { MachineContext } from '@/hsm/context'
import type { MachineGuardParams } from '@/hsm/types'

import { isFinitePosition } from '@/utils/minecraft/spatial'

export const hasFreshThreatObservation = (context: MachineContext) =>
	isFinitePosition(context.bot?.entity?.position) &&
	context.threatObservationProblem === null &&
	context.threatObservationAt !== null &&
	Date.now() - context.threatObservationAt <=
		context.preferences.threatRetentionMs

export const isRecoveryDistanceSafe = (context: MachineContext) =>
	hasFreshThreatObservation(context) &&
	(!context.nearestThreat ||
		(Number.isFinite(context.nearestThreat.distance) &&
			context.nearestThreat.distance >= context.preferences.safeEatDistance))

export const isRecoverySafe = (context: MachineContext) =>
	!context.recoveryRelocation && isRecoveryDistanceSafe(context)

/** Only an already active meal may use the inner interruption boundary. */
export const isHungerRecoverySafe = (context: MachineContext) =>
	isRecoverySafe(context) ||
	Boolean(
		context.bot?.autoEat.isEating &&
		!context.recoveryRelocation &&
		hasFreshThreatObservation(context) &&
		(!context.nearestThreat ||
			(Number.isFinite(context.nearestThreat.distance) &&
				context.nearestThreat.distance >
					context.preferences.interruptEatDistance))
	)

export const canAttemptRecovery = (context: MachineContext) =>
	context.recoveryFailure === null ||
	(context.recoveryFailure === 'no_food' &&
		(context.bot?.utils.getAllFood().length ?? 0) > 0)

export const canPreemptForHungerRecovery = ({
	context,
	event
}: MachineGuardParams) =>
	event.type === 'UPDATE_FOOD' &&
	isRecoverySafe(context) &&
	canAttemptRecovery(context) &&
	event.food < context.preferences.foodEmergency
