import { Vec3 } from 'vec3'

import type { MachineContext, ThreatObservation } from '@/hsm/context.js'

import { isFinitePosition } from '@/utils/minecraft/spatial.js'

type Position = Pick<Vec3, 'x' | 'y' | 'z'>

// Pathfinder moves toward block centres. The initial centring step can shift
// either horizontal coordinate by half a block even on a lateral escape.
const blockCenterDistance = Math.SQRT1_2

const distance = (a: Position, b: Position) =>
	Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)

const segmentDistance = (point: Position, from: Position, to: Position) => {
	const dx = to.x - from.x
	const dy = to.y - from.y
	const dz = to.z - from.z
	const lengthSquared = dx * dx + dy * dy + dz * dz
	const fraction = lengthSquared
		? Math.max(
				0,
				Math.min(
					1,
					((point.x - from.x) * dx +
						(point.y - from.y) * dy +
						(point.z - from.z) * dz) /
						lengthSquared
				)
			)
		: 0
	return distance(point, {
		x: from.x + dx * fraction,
		y: from.y + dy * fraction,
		z: from.z + dz * fraction
	})
}

/** A route may detour, but cannot cross close danger or finish less safe. */
export class EscapeSafety {
	private readonly hazards: { position: Vec3; radius: number }[]
	private readonly initialClearance: number

	constructor(
		origin: Vec3,
		threats: ThreatObservation[],
		private readonly preferences: MachineContext['preferences']
	) {
		this.hazards = threats.map(threat => ({
			position: threat.position.clone(),
			radius: Math.min(
				Math.max(0, origin.distanceTo(threat.position) - blockCenterDistance),
				threat.creeper
					? preferences.creeperDangerDistance
					: preferences.selfDefenseDistance
			)
		}))
		this.initialClearance = this.clearance(origin)
	}

	allowsPosition(position: Position) {
		return (
			isFinitePosition(position) &&
			this.hazards.every(
				hazard => distance(position, hazard.position) >= hazard.radius
			)
		)
	}

	allowsPath(
		origin: Position,
		path: readonly Position[],
		complete: boolean,
		requiredProgress = this.preferences.movementProgressDistance
	) {
		let previous = origin
		for (const position of path) {
			if (
				!isFinitePosition(position) ||
				this.hazards.some(
					hazard =>
						segmentDistance(hazard.position, previous, position) < hazard.radius
				)
			)
				return false
			previous = position
		}
		return (
			!complete ||
			this.hazards.length === 0 ||
			this.clearance(previous) >= this.initialClearance + requiredProgress
		)
	}

	private clearance(position: Position) {
		return Math.min(
			...this.hazards.map(hazard => distance(position, hazard.position))
		)
	}
}
