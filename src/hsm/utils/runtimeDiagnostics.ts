import type { ActorRefFrom, StateValue } from 'xstate'

import Logger from '@/config/logger.js'

import type { MachineContext } from '@/hsm/context.js'
import type { machine } from '@/hsm/machine.js'

import { isFinitePosition } from '@/utils/minecraft/spatial.js'

const heartbeatMs = 5000
const rounded = (value: number) =>
	Number.isFinite(value) ? Number(value.toFixed(2)) : null
const coordinates = (
	position: { x: number; y: number; z: number } | undefined
) =>
	position
		? { x: rounded(position.x), y: rounded(position.y), z: rounded(position.z) }
		: null

const statePaths = (value: StateValue, prefix = ''): string[] =>
	typeof value === 'string'
		? [`${prefix}${value}`]
		: Object.entries(value).flatMap(([key, child]) =>
				child === undefined ? [] : statePaths(child, `${prefix}${key}.`)
			)

const facts = (context: MachineContext) => ({
	health: rounded(context.health),
	food: context.food,
	movementOwner: context.movementOwner,
	position: coordinates(context.bot?.entity?.position),
	positionValid: isFinitePosition(context.bot?.entity?.position),
	observationProblem: context.threatObservationProblem,
	nearestThreat: context.nearestThreat
		? {
				id: context.nearestThreat.entityId,
				kind: context.nearestThreat.kind,
				distance: rounded(context.nearestThreat.distance),
				observed: context.nearestThreat.observed,
				creeper: context.nearestThreat.creeper
			}
		: null,
	targetId: context.combatTarget.entity?.id ?? null,
	observationAgeMs:
		context.threatObservationAt === null
			? null
			: Date.now() - context.threatObservationAt,
	eating: context.bot?.autoEat?.isEating ?? false,
	pvpTargetId: context.bot?.pvp?.target?.id ?? null,
	relocationRequired: context.recoveryRelocation !== null,
	recoveryFailure: context.recoveryFailure
})

/** Read-only observer. Never logs event payloads, prompts, credentials or full entities. */
export const attachHsmDiagnostics = (
	actor: ActorRefFrom<typeof machine>,
	configuredVersion?: string
) => {
	let previousState = ''
	let stateSince = Date.now()
	let lastEvent = 'INITIAL_SNAPSHOT'
	let lastEventAt = Date.now()
	let sampledAt = Date.now()
	let position = actor.getSnapshot().context.bot?.entity?.position
	let sampledPosition = position
		? { x: position.x, y: position.y, z: position.z }
		: null
	let stopped = false
	let damageSequence = actor.getSnapshot().context.lastDamage.sequence
	const reportTransition = () => {
		const snapshot = actor.getSnapshot()
		if (snapshot.context.lastDamage.sequence !== damageSequence) {
			damageSequence = snapshot.context.lastDamage.sequence
			Logger.info('[HSM] damage', {
				sourceId: snapshot.context.lastDamage.sourceId,
				sourcePosition: coordinates(
					snapshot.context.lastDamage.sourcePosition ?? undefined
				),
				...facts(snapshot.context)
			})
		}
		const state = statePaths(snapshot.value).join(' | ')
		if (state === previousState) return
		Logger.info('[HSM] transition', {
			event: lastEvent,
			from: previousState || null,
			to: state,
			previousStateMs: Date.now() - stateSince,
			...facts(snapshot.context)
		})
		previousState = state
		stateSince = Date.now()
	}
	const inspection = actor.system.inspect(event => {
		if (
			event.type === '@xstate.snapshot' &&
			event.actorRef === actor &&
			!stopped
		) {
			lastEvent = event.event.type
			lastEventAt = Date.now()
			reportTransition()
		}
	})
	const timer = setInterval(() => {
		if (stopped) return
		const snapshot = actor.getSnapshot()
		position = snapshot.context.bot?.entity?.position
		const moved =
			position && sampledPosition
				? Math.hypot(
						position.x - sampledPosition.x,
						position.y - sampledPosition.y,
						position.z - sampledPosition.z
					)
				: null
		Logger.info('[HSM] heartbeat', {
			state: statePaths(snapshot.value),
			status: snapshot.status,
			stateMs: Date.now() - stateSince,
			lastEvent,
			lastEventAgoMs: Date.now() - lastEventAt,
			windowMs: Date.now() - sampledAt,
			displacement: moved === null ? null : rounded(moved),
			...facts(snapshot.context)
		})
		sampledAt = Date.now()
		sampledPosition = position
			? { x: position.x, y: position.y, z: position.z }
			: null
	}, heartbeatMs)
	const dispose = () => {
		if (stopped) return
		stopped = true
		clearInterval(timer)
		inspection.unsubscribe()
		Logger.info('[HSM] diagnostics_stopped', { state: previousState })
	}
	const subscription = actor.subscribe({ complete: dispose, error: dispose })
	const context = actor.getSnapshot().context
	Logger.info('[HSM] runtime', {
		configuredMinecraftVersion: configuredVersion ?? null,
		registryVersion: context.bot?.registry?.version?.minecraftVersion ?? null,
		selfDefenseDistance: context.preferences.selfDefenseDistance,
		rangedAttackRange: context.preferences.rangedAttackRange,
		meleeSwitchDistance: context.preferences.enemyMeleeRange,
		healthEmergency: context.preferences.healthEmergency,
		healthRestored: context.preferences.healthFullyRestored,
		safeEatDistance: context.preferences.safeEatDistance,
		interruptEatDistance: context.preferences.interruptEatDistance,
		heartbeatMs
	})
	reportTransition()
	return () => {
		dispose()
		subscription.unsubscribe()
	}
}
