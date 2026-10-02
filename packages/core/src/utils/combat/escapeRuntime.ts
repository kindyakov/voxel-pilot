import { Movements } from 'mineflayer-pathfinder'
import type { PartiallyComputedPath } from 'mineflayer-pathfinder'
import { Vec3 } from 'vec3'

import type { Bot } from '@/types/index.js'

import Logger from '@/config/logger.js'

import type { MachineContext, ThreatObservation } from '@/hsm/context.js'

import { GoalXZ } from '@/modules/plugins/goals.js'

import { isFinitePosition } from '@/utils/minecraft/spatial.js'

import { EscapeSafety } from './escapeSafety.js'
import { hasMovementController } from './movementController.js'
import { MovementProgress } from './movementProgress.js'
import {
	clearMicroMovement,
	enableMicroMovement,
	stopPathfinderMovement
} from './runtimeControl.js'

type EscapeMode = 'NONE' | 'MOVEMENT' | 'PATHFINDER'
// Upstream incorrectly narrows generator results to ComputedPath (omits partial).
type RouteSearch = IterableIterator<{ result: PartiallyComputedPath }>

const snapshotThreats = (threats: ThreatObservation[]) =>
	new Map(threats.map(threat => [threat.entityId, threat.position.clone()]))

/** One invoked behavior owns this runtime; it owns no independent loop or subscriptions. */
export class EscapeRuntime {
	private mode: EscapeMode = 'NONE'
	private readonly movements: Movements
	private readonly progress: MovementProgress
	private goal: Vec3 | null = null
	private search: RouteSearch | null = null
	private candidates: Vec3[] = []
	private blockedAt: Vec3 | null = null
	private blockedThreats = new Map<number, Vec3>()
	private microFailed = false
	private steeringThreat: Vec3 | null = null
	// Borrowed read-only: pathfinder consumes this array as it reaches its nodes.
	private routePath: readonly { x: number; y: number; z: number }[] | null =
		null
	private routeComplete = false
	private threats: ThreatObservation[] = []
	private routeSafety: EscapeSafety | null = null

	constructor(
		private readonly bot: Bot,
		private readonly preferences: MachineContext['preferences']
	) {
		this.movements = new Movements(bot)
		this.movements.canDig = false
		this.movements.allow1by1towers = false
		this.movements.scafoldingBlocks = []
		this.movements.allowSprinting = true
		this.movements.exclusionAreasStep.push(block =>
			this.routeSafety?.allowsPosition(block.position.offset(0.5, 0, 0.5)) ===
			false
				? Infinity
				: 0
		)
		this.progress = new MovementProgress(
			preferences.escapeNoProgressMs,
			preferences.movementProgressDistance
		)
	}

	stop() {
		clearMicroMovement(this.bot)
		if (this.mode !== 'NONE' || this.goal) stopPathfinderMovement(this.bot)
		this.mode = 'NONE'
		this.goal = null
		this.search = null
		this.candidates = []
		this.steeringThreat = null
		this.routePath = null
		this.routeComplete = false
		this.routeSafety = null
		this.progress.reset()
	}

	worldChanged(position?: Vec3) {
		if (
			position &&
			this.bot.entity.position.distanceTo(position) >
				this.preferences.fleeTargetDistance * 2
		)
			return
		this.blockedAt = null
		this.blockedThreats.clear()
		this.microFailed = false
	}

	routeFailed(reason = 'pathfinder_failure') {
		if (!this.goal || this.search) return
		Logger.warn('[SURVIVAL] route_failed', {
			reason,
			goal: { x: this.goal.x, z: this.goal.z },
			remainingCandidates: this.candidates.length
		})
		stopPathfinderMovement(this.bot)
		this.goal = null
		this.routePath = null
		this.progress.reset()
	}

	routeUpdated(result: {
		status?: string
		path?: Array<{ x: number; y: number; z: number }>
	}) {
		if (this.mode !== 'PATHFINDER' || !this.goal || this.search) return
		if (result.status === 'noPath' || result.status === 'timeout') {
			this.routeFailed(result.status)
			return
		}
		this.routeSafety = new EscapeSafety(
			this.bot.entity.position,
			this.threats,
			this.preferences
		)
		if (
			result.path?.length &&
			this.routeSafety &&
			!this.routeSafety.allowsPath(
				this.bot.entity.position,
				result.path,
				result.status === 'success'
			)
		) {
			this.routeFailed('unsafe_escape_path')
			return
		}
		this.routePath = result.path ?? null
		this.routeComplete = result.status === 'success'
	}

	async physicsTick() {
		if (this.mode !== 'MOVEMENT' || !this.steeringThreat) return
		if (
			!isFinitePosition(this.bot.entity.position) ||
			!isFinitePosition(this.steeringThreat)
		) {
			this.stop()
			return
		}
		const position: Vec3 = this.bot.entity.position
		let yaw = Math.atan2(
			this.steeringThreat.x - position.x,
			this.steeringThreat.z - position.z
		)
		enableMicroMovement(this.bot)
		if (hasMovementController(this.bot)) {
			this.bot.movement.setGoal(this.bot.movement.goals.Default)
			this.bot.movement.heuristic
				.get('proximity')
				.target(this.steeringThreat)
				.avoid(true)
			yaw = this.bot.movement.getYaw(360, 36, 1)
			if (!Number.isFinite(yaw)) throw new Error('Invalid escape steering')
			await this.bot.movement.steer(yaw, true)
		}
	}

	move(
		threat: ThreatObservation | null,
		threats: ThreatObservation[],
		relocation: Vec3 | null
	): EscapeMode {
		this.threats = threats
		const position: Vec3 = this.bot.entity.position
		if (
			!isFinitePosition(position) ||
			(threat && !isFinitePosition(threat.position))
		) {
			this.stop()
			return 'NONE'
		}
		if (this.mode === 'PATHFINDER') {
			const safety = new EscapeSafety(position, threats, this.preferences)
			// Refresh all hazards, but stop only when the remaining path became unsafe
			// or no longer preserves clearance. Progress already made must not be demanded again.
			if (
				this.routePath?.length &&
				!safety.allowsPath(position, this.routePath, this.routeComplete, 0)
			) {
				Logger.info('[SURVIVAL] route_replanned', {
					reason: 'remaining_route_unsafe',
					threatId: threat?.entityId ?? null
				})
				this.stop()
				this.microFailed = false
			} else this.routeSafety = safety
		}
		if (this.blockedAt) {
			const displaced =
				Math.hypot(
					position.x - this.blockedAt.x,
					position.z - this.blockedAt.z
				) >= this.preferences.movementProgressDistance
			const threatsChanged = this.hasThreatLayoutChanged(
				this.blockedThreats,
				threats
			)
			if (!displaced && !threatsChanged) return 'NONE'
			this.blockedAt = null
			this.blockedThreats.clear()
		}
		if (
			!relocation &&
			threat &&
			threat.distance < 15 &&
			threats.filter(
				candidate => candidate.distance <= this.preferences.selfDefenseDistance
			).length <= 1 &&
			!this.microFailed &&
			this.mode !== 'PATHFINDER' &&
			hasMovementController(this.bot)
		) {
			if (this.mode !== 'MOVEMENT') {
				Logger.info('[SURVIVAL] micro_flee_started', {
					threatId: threat.entityId,
					distance: Number(threat.distance.toFixed(2))
				})
				stopPathfinderMovement(this.bot)
				this.progress.reset()
			}
			this.mode = 'MOVEMENT'
			this.steeringThreat = threat.position
			if (this.progress.observe(position, -threat.distance, Date.now())) {
				// Apply controls immediately; rotation is updated by the next physics tick.
				enableMicroMovement(this.bot)
				return this.mode
			}
			this.microFailed = true
			Logger.warn('[SURVIVAL] movement_stalled', {
				controller: 'MOVEMENT',
				noProgressMs: this.preferences.escapeNoProgressMs,
				threatId: threat.entityId
			})
			this.stop()
		}
		if (this.goal && !this.search) {
			const remaining = Math.hypot(
				position.x - this.goal.x,
				position.z - this.goal.z
			)
			if (remaining < 1.5) {
				this.stop()
				this.microFailed = false
			} else if (this.progress.observe(position, remaining, Date.now()))
				return 'PATHFINDER'
			else this.routeFailed('no_actual_progress')
		}
		if (this.mode !== 'PATHFINDER') {
			clearMicroMovement(this.bot)
			this.routeSafety = new EscapeSafety(position, threats, this.preferences)
			this.bot.pathfinder.setMovements(this.movements)
			this.mode = 'PATHFINDER'
			const away = threat
				? Math.atan2(
						position.z - threat.position.z,
						position.x - threat.position.x
					)
				: 0
			this.candidates = Array.from(
				{ length: this.preferences.escapeRouteAttempts },
				(_, index) => {
					const angle =
						away + (index * Math.PI * 2) / this.preferences.escapeRouteAttempts
					return position.offset(
						Math.cos(angle) * this.preferences.fleeTargetDistance,
						0,
						Math.sin(angle) * this.preferences.fleeTargetDistance
					)
				}
			).sort((a, b) => this.clearance(b, threats) - this.clearance(a, threats))
			if (relocation) this.candidates.unshift(relocation)
		}
		if (!this.search) {
			this.goal = this.candidates.shift() ?? null
			if (!this.goal) {
				Logger.warn('[SURVIVAL] routes_exhausted', {
					attempts: this.preferences.escapeRouteAttempts,
					threatId: threat?.entityId ?? null,
					position: { x: position.x, y: position.y, z: position.z }
				})
				this.stop()
				this.blockedAt = position.clone()
				this.blockedThreats = snapshotThreats(threats)
				this.bot.chat(
					'Застрял: проходимый выход не найден. Продолжаю следить за возможностью отхода.'
				)
				return 'NONE'
			}
			this.search = this.bot.pathfinder.getPathFromTo(
				this.movements,
				position,
				new GoalXZ(Math.floor(this.goal.x), Math.floor(this.goal.z)),
				{
					timeout: this.preferences.escapeRouteTimeoutMs,
					tickTimeout: this.preferences.escapeSearchSliceMs,
					searchRadius: this.preferences.fleeTargetDistance * 2
				}
			)
			Logger.info('[SURVIVAL] route_search_started', {
				goal: { x: this.goal.x, z: this.goal.z },
				timeoutMs: this.preferences.escapeRouteTimeoutMs,
				remainingCandidates: this.candidates.length
			})
		}
		const next = this.search.next()
		if (next.done || next.value.result.status !== 'partial') {
			Logger.info('[SURVIVAL] route_search_finished', {
				status: next.done ? 'empty_result' : next.value.result.status,
				pathLength: next.done ? 0 : next.value.result.path.length,
				goal: this.goal ? { x: this.goal.x, z: this.goal.z } : null
			})
			this.search = null
			if (
				!next.done &&
				next.value.result.status === 'success' &&
				next.value.result.path.length &&
				this.goal &&
				this.routeSafety?.allowsPath(position, next.value.result.path, true)
			) {
				this.routePath = next.value.result.path
				this.routeComplete = true
				this.bot.pathfinder.setGoal(
					new GoalXZ(Math.floor(this.goal.x), Math.floor(this.goal.z))
				)
				this.progress.reset()
			} else this.goal = null
		}
		return this.mode
	}

	private hasThreatLayoutChanged(
		previous: ReadonlyMap<number, Vec3>,
		threats: ThreatObservation[]
	) {
		return (
			previous.size !== threats.length ||
			threats.some(threat => {
				const position = previous.get(threat.entityId)
				return (
					!position ||
					threat.position.distanceTo(position) >=
						this.preferences.escapeThreatChangeDistance
				)
			})
		)
	}

	private clearance(position: Vec3, threats: ThreatObservation[]) {
		return threats.length
			? Math.min(...threats.map(threat => position.distanceTo(threat.position)))
			: 0
	}
}
