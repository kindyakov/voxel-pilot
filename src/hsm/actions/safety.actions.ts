import { assign } from 'xstate'

import type { MachineContext } from '@/hsm/context.js'
import type { MachineEvent } from '@/hsm/types.js'

import {
	blockApproach,
	recordApproach,
	resumeApproach
} from '@/utils/combat/approachPolicy.js'
import {
	planRecoveryRelocation,
	refreshRecoveryRelocation
} from '@/utils/combat/recoveryRelocation.js'

export const safetyActions = {
	refreshRecoveryPosition: assign<
		MachineContext,
		MachineEvent,
		undefined,
		MachineEvent,
		never
	>(({ context }) => ({
		recoveryRelocation: refreshRecoveryRelocation(context)
	})),
	blockCombatApproach: assign<
		MachineContext,
		MachineEvent,
		undefined,
		MachineEvent,
		never
	>(({ context }) => ({
		approachAttempts: blockApproach(context),
		rangedUnavailable: true
	})),
	resumeCombatApproach: assign<
		MachineContext,
		MachineEvent,
		undefined,
		MachineEvent,
		never
	>(({ context }) => ({ approachAttempts: resumeApproach(context) })),
	recordCombatApproach: assign<
		MachineContext,
		MachineEvent,
		undefined,
		MachineEvent,
		never
	>(({ context }) => ({ approachAttempts: recordApproach(context, false) })),
	recordApproachRouteFailure: assign<
		MachineContext,
		MachineEvent,
		undefined,
		MachineEvent,
		never
	>(({ context }) => ({ approachAttempts: recordApproach(context, true) })),
	observeRecoveryFood: assign<
		MachineContext,
		MachineEvent,
		undefined,
		MachineEvent,
		never
	>(({ event }) =>
		event.type === 'RECOVERY_FOOD_AVAILABILITY'
			? { recoveryNoFoodNotified: !event.available }
			: {}
	),
	storeRecoveryRelocation: assign<
		MachineContext,
		MachineEvent,
		undefined,
		MachineEvent,
		never
	>(({ event }) =>
		event.type === 'RECOVERY_RELOCATION'
			? { recoveryRelocation: event.relocation }
			: {}
	),
	observeDamage: assign<
		MachineContext,
		MachineEvent,
		undefined,
		MachineEvent,
		never
	>(({ context, event }) => {
		if (event.type !== 'DAMAGE_OBSERVED') return {}
		let recoveryRelocation = context.recoveryRelocation
		const bot = context.bot
		if (bot?.autoEat?.isEating)
			recoveryRelocation = planRecoveryRelocation(
				bot.entity?.position,
				event.sourcePosition ?? context.nearestThreat?.position ?? null,
				bot.entity?.yaw,
				context.preferences.fleeTargetDistance
			)
		return {
			recoveryRelocation,
			aggressionByEntity:
				event.sourceId === null
					? context.aggressionByEntity
					: { ...context.aggressionByEntity, [event.sourceId]: Date.now() },
			lastDamage: {
				sequence: context.lastDamage.sequence + 1,
				observedAt: Date.now(),
				sourceId: event.sourceId,
				sourcePosition: event.sourcePosition
			}
		}
	}),
	cancelDamagedEating: ({ context }: { context: MachineContext }) => {
		if (context.recoveryRelocation) context.bot?.utils.stopEating()
	},
	observePassability: assign<
		MachineContext,
		MachineEvent,
		undefined,
		MachineEvent,
		never
	>(({ context, event }) =>
		event.type === 'PASSABILITY_CHANGED'
			? {
					approachAttempts: Object.fromEntries(
						Object.entries(context.approachAttempts).map(([id, attempt]) => [
							id,
							attempt.blocked &&
							context.bot &&
							context.bot.entity.position.distanceTo(event.position) <=
								context.preferences.fleeTargetDistance * 2
								? { ...attempt, worldChanged: true }
								: attempt
						])
					)
				}
			: {}
	)
}
