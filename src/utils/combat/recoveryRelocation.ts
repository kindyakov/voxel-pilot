import type { Vec3 } from 'vec3'

import type { MachineContext, RecoveryRelocation } from '@/hsm/context'

import { isFinitePosition } from '@/utils/minecraft/spatial'

/** Preserve the obligation without manufacturing a position while observations are invalid. */
export const planRecoveryRelocation = (
	position: Vec3 | undefined,
	sourcePosition: Vec3 | null,
	yaw: number | undefined,
	distance: number
): RecoveryRelocation => {
	const source =
		sourcePosition && isFinitePosition(sourcePosition)
			? sourcePosition.clone()
			: null
	const pending: RecoveryRelocation = {
		status: 'pending',
		sourcePosition: source
	}
	if (!position || !isFinitePosition(position)) return pending
	const awayYaw = source
		? Math.atan2(source.x - position.x, source.z - position.z)
		: yaw
	if (awayYaw === undefined || !Number.isFinite(awayYaw)) return pending
	return {
		status: 'planned',
		from: position.clone(),
		goal: position.offset(
			-Math.sin(awayYaw) * distance,
			0,
			-Math.cos(awayYaw) * distance
		)
	}
}

/** Position evidence updates the obligation even when no recovery actor is running. */
export const refreshRecoveryRelocation = (
	context: MachineContext
): RecoveryRelocation | null => {
	let relocation = context.recoveryRelocation
	const position = context.bot?.entity?.position
	if (!relocation || !position || !isFinitePosition(position)) return relocation
	if (relocation.status === 'pending')
		relocation = planRecoveryRelocation(
			position,
			relocation.sourcePosition ?? context.nearestThreat?.position ?? null,
			context.bot?.entity?.yaw,
			context.preferences.fleeTargetDistance
		)
	if (
		relocation.status === 'planned' &&
		Math.hypot(
			position.x - relocation.from.x,
			position.z - relocation.from.z
		) >=
			context.preferences.fleeTargetDistance - 1
	)
		return null
	return relocation
}
