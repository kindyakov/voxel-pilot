import { assign } from 'xstate'

import type { MachineContext } from '@/hsm/context.js'
import type { MachineEvent } from '@/hsm/types.js'

import {
	blockApproach,
	recordApproach,
	resumeApproach
} from '@/utils/combat/approachPolicy.js'
import { hasAvailableDefense } from '@/utils/combat/defensiveResponse.js'
import {
	planRecoveryRelocation,
	refreshRecoveryRelocation
} from '@/utils/combat/recoveryRelocation.js'
import { isFinitePosition } from '@/utils/minecraft/spatial.js'

export const safetyActions = {
	startDefensiveRelocation: assign<
		MachineContext,
		MachineEvent,
		undefined,
		MachineEvent,
		never
	>(({ context }) => ({
		defensiveRelocation: context.defensiveRelocation ?? {
			from: isFinitePosition(context.bot?.entity?.position)
				? context.bot!.entity.position.clone()
				: null,
			sourceId: context.lastDamage.sourceId,
			sourcePosition: context.lastDamage.sourcePosition?.clone() ?? null
		}
	})),
	finishDefensiveRelocation: assign<
		MachineContext,
		MachineEvent,
		undefined,
		MachineEvent,
		never
	>(({ context }) => ({
		defensiveRelocation: null,
		defensiveDamageHandled: context.lastDamage.sequence
	})),
	refreshRecoveryPosition: assign<
		MachineContext,
		MachineEvent,
		undefined,
		MachineEvent,
		never
	>(({ context }) => ({
		recoveryRelocation: refreshRecoveryRelocation(context),
		defensiveRelocation:
			context.defensiveRelocation &&
			!context.defensiveRelocation.from &&
			isFinitePosition(context.bot?.entity?.position)
				? {
						...context.defensiveRelocation,
						from: context.bot!.entity.position.clone()
					}
				: context.defensiveRelocation
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
	>(({ context, event }) => ({
		approachAttempts: recordApproach(
			context,
			false,
			event.type === 'APPROACH_SAMPLE' ? event.waypoint : undefined
		)
	})),
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
			// A new hit revokes previous departure/safety proof, including during retreat.
			defensiveRelocation: context.defensiveRelocation
				? {
						from: isFinitePosition(bot?.entity?.position)
							? bot!.entity.position.clone()
							: null,
						sourceId: event.sourceId,
						sourcePosition: event.sourcePosition?.clone() ?? null
					}
				: null,
			defensiveDamageHandled:
				event.sourceId === null && hasAvailableDefense(context, true)
					? context.lastDamage.sequence + 1
					: context.defensiveDamageHandled,
			attackContacts:
				event.sourceId === null
					? context.attackContacts
					: {
							...context.attackContacts,
							[event.sourceId]: {
								entity:
									bot?.entities[event.sourceId] ??
									context.entities.find(
										entity => entity.id === event.sourceId
									) ??
									context.enemies.find(
										entity => entity.id === event.sourceId
									) ??
									null,
								ranged:
									event.ranged === true ||
									context.attackContacts[event.sourceId]?.ranged === true,
								lastObservedAt: Date.now(),
								position: event.sourcePosition?.clone() ?? null
							}
						},
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
