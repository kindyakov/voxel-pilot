import type { GuardParams } from '../types'

const canUseRanged = ({ context }: GuardParams): boolean => {
	const weapon = context.bot?.utils.getRangeWeapon()
	const arrows = context.bot?.utils.getArrow()
	return !!weapon && !!arrows
}

const canUseRangedAndEnemyFar = ({ context }: GuardParams): boolean => {
	return (
		canUseRanged({ context }) &&
		context.nearestEnemy?.distance > context.preferences.enemyRangedRange
	)
}

const isSurrounded = ({ context, event }: GuardParams): boolean => false

export default {
	canUseRanged,
	canUseRangedAndEnemyFar,
	isSurrounded
}
