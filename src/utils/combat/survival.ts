import type { Entity } from '@/types'

import type { MachineContext } from '@/hsm/context'

export type SurvivalMode = 'IDLE' | 'EATING' | 'MOVEMENT' | 'PATHFINDER'

type Vec3Like = {
	x: number
	y: number
	z: number
}

export const SURVIVAL_MOVEMENT_DISTANCE = 15

const getDistance = (left: Vec3Like | null, right: Vec3Like | null): number => {
	if (!left || !right) {
		return Number.POSITIVE_INFINITY
	}

	if (typeof (left as any).distanceTo === 'function') {
		return (left as any).distanceTo(right)
	}

	const dx = left.x - right.x
	const dy = left.y - right.y
	const dz = left.z - right.z
	return Math.sqrt(dx * dx + dy * dy + dz * dz)
}

const isValidEnemy = (
	position: Vec3Like | null,
	maxDistance: number,
	enemy: Entity | null | undefined
): enemy is Entity =>
	Boolean(
		enemy?.position &&
			enemy.isValid !== false &&
			getDistance(position, enemy.position as Vec3Like) <= maxDistance
	)

export const resolveSurvivalThreat = (
	context: Pick<
		MachineContext,
		'bot' | 'position' | 'nearestEnemy' | 'enemies' | 'preferences'
	>
): { entity: Entity | null; distance: number } => {
	const position = context.position ?? context.bot?.entity.position ?? null
	const maxDistance = context.preferences.safeEatDistance

	if (isValidEnemy(position, maxDistance, context.nearestEnemy.entity)) {
		return {
			entity: context.nearestEnemy.entity,
			distance: getDistance(position, context.nearestEnemy.entity.position)
		}
	}

	const fallbackEnemy =
		context.enemies
			.filter(enemy => isValidEnemy(position, maxDistance, enemy))
			.sort(
				(left, right) =>
					getDistance(position, left.position) - getDistance(position, right.position)
			)[0] ?? null

	if (fallbackEnemy) {
		return {
			entity: fallbackEnemy,
			distance: getDistance(position, fallbackEnemy.position)
		}
	}

	const scannedEnemy = context.bot?.utils.findNearestEnemy(maxDistance) ?? null
	if (isValidEnemy(position, maxDistance, scannedEnemy)) {
		return {
			entity: scannedEnemy,
			distance: getDistance(position, scannedEnemy.position)
		}
	}

	return { entity: null, distance: Number.POSITIVE_INFINITY }
}

export const calculateDangerCenter = (
	position: Vec3Like | null,
	enemies: Entity[]
): Vec3Like | null => {
	const relevantEnemies = enemies.filter(enemy =>
		isValidEnemy(position, Number.POSITIVE_INFINITY, enemy)
	)

	if (relevantEnemies.length === 0) {
		return position
	}

	let weightedX = 0
	let weightedY = 0
	let weightedZ = 0
	let totalWeight = 0

	for (const enemy of relevantEnemies) {
		const distance = Math.max(
			getDistance(position, enemy.position),
			1
		)
		const weight = 1 / distance

		weightedX += enemy.position.x * weight
		weightedY += enemy.position.y * weight
		weightedZ += enemy.position.z * weight
		totalWeight += weight
	}

	if (totalWeight === 0) {
		return position
	}

	return {
		x: weightedX / totalWeight,
		y: weightedY / totalWeight,
		z: weightedZ / totalWeight
	}
}

export const canFleeToPlayer = (
	context: Pick<MachineContext, 'preferences' | 'enemies'>,
	position: Vec3Like | null,
	player: Entity | null
): player is Entity => {
	if (!player?.position || !position) {
		return false
	}

	if (
			getDistance(position, player.position) >
		context.preferences.fleeToPlayerRadius
	) {
		return false
	}

	return context.enemies.every(enemy => {
		if (!enemy?.position || enemy.isValid === false) {
			return true
		}

		return (
			getDistance(player.position, enemy.position) >
			context.preferences.safePlayerDistance
		)
	})
}
