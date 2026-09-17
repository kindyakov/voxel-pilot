import type { Entity } from '@/types/index.js'

import type { MachineContext } from '@/hsm/context.js'

export type SurvivalMode = 'IDLE' | 'EATING' | 'MOVEMENT' | 'PATHFINDER'
type Position = { x: number; y: number; z: number }
export const SURVIVAL_MOVEMENT_DISTANCE = 15

const getDistance = (left: Position, right: Position) =>
	Math.hypot(left.x - right.x, left.y - right.y, left.z - right.z)

export const canFleeToPlayer = (
	context: Pick<MachineContext, 'preferences' | 'threats'>,
	position: Position | null,
	player: Entity | null
): player is Entity => {
	if (!player?.position || !position) return false
	if (
		getDistance(position, player.position) >
		context.preferences.fleeToPlayerRadius
	)
		return false
	return context.threats.every(
		threat =>
			getDistance(player.position, threat.position) >
			context.preferences.safePlayerDistance
	)
}
