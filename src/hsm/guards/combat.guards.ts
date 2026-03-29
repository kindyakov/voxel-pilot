import type { MachineGuardParams } from '@hsm/types'

import { canSeeEnemy } from '@utils/combat/enemyVisibility'

const canUseRanged = ({ context }: MachineGuardParams): boolean => {
	const weapon = context.bot?.utils.getRangeWeapon()
	const arrows = context.bot?.utils.getArrow()
	const hasWeaponAndArrows = !!weapon && !!arrows

	if (!hasWeaponAndArrows) return false

	// Проверка видимости врага (raycast)
	if (!context.bot || !context.nearestEnemy?.entity) return false

	return canSeeEnemy(context.bot, context.nearestEnemy.entity)
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

export default {
	canUseRangedAndEnemyFar
}
