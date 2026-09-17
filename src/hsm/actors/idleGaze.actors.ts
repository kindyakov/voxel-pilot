import type { Bot, Entity, Vec3 } from '@/types/index.js'

import Logger from '@/config/logger.js'

import type { MachineContext } from '@/hsm/context.js'
import { hasFreshThreatObservation } from '@/hsm/guards/survival.guards.js'
import {
	type BaseServiceState,
	createStatefulService
} from '@/hsm/helpers/createStatefulService.js'

import { assessMob } from '@/utils/combat/selfDefense.js'
import { isFinitePosition } from '@/utils/minecraft/spatial.js'

const MIN_HOLD_MS = 3000
const MAX_HOLD_MS = 5000
const ALTERNATIVE_CHANCE = 0.2

interface GazeState extends BaseServiceState {
	target: Entity | null
	reconsiderAt: number
}

const headPosition = (entity: Entity): Vec3 | null => {
	// Mineflayer supplies eyeHeight for players; ordinary mobs expose height.
	const eyeHeight = 'eyeHeight' in entity ? entity.eyeHeight : undefined
	if (
		eyeHeight !== undefined &&
		(typeof eyeHeight !== 'number' ||
			!Number.isFinite(eyeHeight) ||
			eyeHeight <= 0)
	)
		return null
	const height =
		typeof eyeHeight === 'number' && Number.isFinite(eyeHeight) && eyeHeight > 0
			? eyeHeight
			: entity.height * 0.9
	return Number.isFinite(height) && height > 0
		? entity.position.offset(0, height, 0)
		: null
}

const hasSightLine = (bot: Bot, from: Vec3, to: Vec3): boolean => {
	// Native raycast skips unloaded columns. Require the small bounding region
	// to be loaded first; unknown space must not become visibility.
	for (
		let x = Math.floor(Math.min(from.x, to.x) / 16);
		x <= Math.floor(Math.max(from.x, to.x) / 16);
		x++
	) {
		for (
			let z = Math.floor(Math.min(from.z, to.z) / 16);
			z <= Math.floor(Math.max(from.z, to.z) / 16);
			z++
		) {
			if (!bot.blockAt(from.offset(x * 16 - from.x, 0, z * 16 - from.z)))
				return false
		}
	}
	if (!bot.blockAt(to)) return false
	const delta = to.minus(from)
	const distance = delta.norm()
	return (
		distance === 0 ||
		bot.world.raycast(from, delta.scaled(1 / distance), distance) === null
	)
}

const gazePoint = (
	context: MachineContext,
	bot: Bot,
	entity: Entity,
	origin: Vec3
): Vec3 | null => {
	if (
		entity === bot.entity ||
		entity.isValid === false ||
		bot.entities[entity.id] !== entity ||
		context.deadEntities.has(entity) ||
		!isFinitePosition(entity.position) ||
		bot.entity.position.distanceTo(entity.position) >
			context.preferences.idleGazeRadius ||
		entity.name === 'enderman' ||
		entity.name === 'armor_stand'
	)
		return null
	const registered = entity.name
		? bot.registry.entitiesByName[entity.name]
		: undefined
	// A non-threat can also be an item, projectile, orb or display. Only living
	// registry categories (or players) qualify; conditional aggression is shared.
	if (
		entity.type !== 'player' &&
		(!registered?.category?.endsWith(' mobs') ||
			registered.type === 'other' ||
			registered.type === 'projectile' ||
			entity.type === 'other' ||
			entity.type === 'projectile' ||
			entity.type === 'orb')
	)
		return null
	if (assessMob(context, entity) !== null) return null
	const point = headPosition(entity)
	return point && hasSightLine(bot, origin, point) ? point : null
}

/** Owns decorative gaze only while invoked by MAIN_ACTIVITY.IDLE. */
export const idleGaze = createStatefulService<GazeState>({
	name: 'idleGaze',
	operationTimeoutMs: 2000,
	errorEvent: error => ({ type: 'IDLE_GAZE_FAILED', error }),
	initialState: { target: null, reconsiderAt: 0 },
	onEvents: () => ({
		physicsTick: ({ bot, context, state, setState }) => {
			if (
				context.health <= 0 ||
				bot.health <= 0 ||
				!hasFreshThreatObservation(context)
			) {
				setState({ target: null, reconsiderAt: 0 })
				return
			}
			const origin = headPosition(bot.entity)
			if (!origin) return
			const now = Date.now()
			const heldPoint =
				state.target && context.entities.includes(state.target)
					? gazePoint(context, bot, state.target, origin)
					: null
			let target = state.target
			let point = heldPoint
			if (!point || now >= state.reconsiderAt) {
				const candidates = context.entities
					.flatMap(entity => {
						const point = gazePoint(context, bot, entity, origin)
						return point
							? [
									{
										entity,
										point,
										distance: bot.entity.position.distanceTo(entity.position)
									}
								]
							: []
					})
					.sort((a, b) => a.distance - b.distance || a.entity.id - b.entity.id)
				let selected = candidates[0]
				// First acquisition/loss always chooses the nearest. Randomness is
				// only sampled on a hold deadline, never on every physics tick.
				if (
					heldPoint &&
					candidates.length > 1 &&
					Math.random() < ALTERNATIVE_CHANCE
				) {
					const alternatives = candidates.filter(
						candidate => candidate.entity !== state.target
					)
					selected =
						alternatives[Math.floor(Math.random() * alternatives.length)]
				}
				target = selected?.entity ?? null
				point = selected?.point ?? null
				if (target !== state.target)
					Logger.debug('[IDLE] gaze_target', {
						targetId: target?.id ?? null,
						name: target?.name ?? target?.type ?? null
					})
				setState({
					target,
					reconsiderAt: target
						? now + MIN_HOLD_MS + Math.random() * (MAX_HOLD_MS - MIN_HOLD_MS)
						: 0
				})
			}
			// lookAt writes the desired angles synchronously, then waits for native
			// smoothing. Never queue another write after await or reset aim on exit.
			return point ? bot.lookAt(point, false) : undefined
		}
	})
})
