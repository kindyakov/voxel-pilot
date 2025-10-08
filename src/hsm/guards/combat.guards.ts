import type { MachineGuardParams } from '@hsm/types'

const canUseRanged = ({ context }: MachineGuardParams): boolean => {
	const weapon = context.bot?.utils.getRangeWeapon()
	const arrows = context.bot?.utils.getArrow()
	return !!weapon && !!arrows
}

const canUseRangedAndEnemyFar = ({
	context,
	event
}: MachineGuardParams): boolean => {
	return (
		canUseRanged({ context, event }) &&
		context.nearestEnemy?.distance > context.preferences.enemyRangedRange
	)
}

const isSurrounded = ({ context, event }: MachineGuardParams): boolean => false

export default {
	canUseRanged,
	canUseRangedAndEnemyFar,
	isSurrounded
}
