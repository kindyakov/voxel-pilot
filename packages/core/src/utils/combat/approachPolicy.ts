import { Vec3 } from 'vec3'

import type { MachineContext } from '@/hsm/context.js'

import { canSeeEnemy } from './enemyVisibility.js'
import { type ProgressAnchor, observeProgress } from './movementProgress.js'

export interface ApproachAttempt {
	progress: ProgressAnchor | null
	routeVisited: Record<string, true>
	failedRoutes: number
	blocked: boolean
	blockedReason: 'approach' | 'controller' | null
	blockedTarget: Vec3 | null
	worldChanged: boolean
	resumes: number
	lastObservedAt: number
}

const freshAttempt = (): ApproachAttempt => ({
	progress: null,
	routeVisited: {},
	failedRoutes: 0,
	blocked: false,
	blockedReason: null,
	blockedTarget: null,
	worldChanged: false,
	resumes: 0,
	lastObservedAt: Date.now()
})

export const blockApproach = (
	context: MachineContext
): MachineContext['approachAttempts'] => {
	const target = context.combatTarget.entity
	if (!target) return context.approachAttempts
	const previous = context.approachAttempts[target.id] ?? freshAttempt()
	return {
		...context.approachAttempts,
		[target.id]: {
			...previous,
			blocked: true,
			blockedReason: 'controller',
			blockedTarget: new Vec3(
				target.position.x,
				target.position.y,
				target.position.z
			),
			worldChanged: false
		}
	}
}

export const refreshApproaches = (
	context: MachineContext,
	observedIds: Set<number>
): MachineContext['approachAttempts'] =>
	Object.fromEntries(
		Object.entries(context.approachAttempts).flatMap(([id, attempt]) => {
			if (observedIds.has(Number(id)))
				return [[id, { ...attempt, lastObservedAt: Date.now() }]]
			return Date.now() - attempt.lastObservedAt <
				context.preferences.approachForgetMs
				? [[id, attempt]]
				: []
		})
	)

export const recordApproach = (
	context: MachineContext,
	routeFailed: boolean,
	waypoint?: Vec3
): MachineContext['approachAttempts'] => {
	const target = context.combatTarget.entity
	const bot = context.bot
	if (!target || !bot) return context.approachAttempts
	const previous = context.approachAttempts[target.id] ?? freshAttempt()
	if (previous.blocked) return context.approachAttempts
	const remaining = bot.entity.position.distanceTo(target.position)
	const reach: number = bot.pvp.attackRange
	let result =
		remaining <= reach && context.bot && canSeeEnemy(context.bot, target)
			? { anchor: null, progressing: true }
			: observeProgress(
					previous.progress,
					bot.entity.position,
					remaining,
					Date.now(),
					context.preferences.approachNoProgressMs,
					context.preferences.movementProgressDistance
				)
	let routeVisited = previous.routeVisited
	const key = waypoint ? `${waypoint.x},${waypoint.y},${waypoint.z}` : null
	if (
		key &&
		waypoint &&
		previous.progress &&
		!routeVisited[key] &&
		Object.keys(routeVisited).length < 8192 &&
		bot.entity.position.distanceTo(waypoint) <= 1.25 &&
		Math.hypot(
			bot.entity.position.x - previous.progress.x,
			bot.entity.position.z - previous.progress.z
		) >= context.preferences.movementProgressDistance
	) {
		routeVisited = { ...routeVisited, [key]: true }
		result = {
			anchor: {
				x: bot.entity.position.x,
				z: bot.entity.position.z,
				remaining: Math.min(previous.progress.remaining, remaining),
				at: Date.now()
			},
			progressing: true
		}
	}
	const failedRoutes = previous.failedRoutes + (routeFailed ? 1 : 0)
	const blocked =
		!result.progressing ||
		failedRoutes >= context.preferences.approachRouteAttempts
	return {
		...context.approachAttempts,
		[target.id]: {
			...previous,
			progress: result.anchor,
			routeVisited,
			failedRoutes,
			blocked,
			blockedReason: blocked ? 'approach' : null,
			blockedTarget: blocked ? target.position.clone() : null,
			lastObservedAt: Date.now()
		}
	}
}

export const approachIsBlocked = (context: MachineContext) => {
	const id = context.combatTarget.entity?.id
	const attempt = id === undefined ? undefined : context.approachAttempts[id]
	if (!attempt?.blocked) return false
	// Exhausting pursuit does not forbid defending in reach, but a broken
	// controller must not be restarted merely because its target is close.
	return (
		attempt.blockedReason !== 'approach' ||
		!context.bot ||
		!context.combatTarget.entity ||
		!canSeeEnemy(context.bot, context.combatTarget.entity) ||
		context.bot.entity.position.distanceTo(
			context.combatTarget.entity.position
		) > context.bot.pvp.attackRange
	)
}

export const canResumeApproach = (context: MachineContext) => {
	const target = context.combatTarget.entity
	if (!target) return false
	const attempt = context.approachAttempts[target.id]
	if (
		attempt?.blockedReason === 'approach' &&
		context.bot &&
		context.bot.entity.position.distanceTo(target.position) <=
			context.bot.pvp.attackRange &&
		canSeeEnemy(context.bot, target)
	)
		return false
	return Boolean(
		attempt?.blocked &&
		attempt.resumes < context.preferences.approachChangedConditionRetries &&
		(attempt.worldChanged ||
			(attempt.blockedReason === 'approach' &&
				attempt.blockedTarget &&
				target.position.distanceTo(attempt.blockedTarget) >=
					context.preferences.escapeThreatChangeDistance))
	)
}

export const resumeApproach = (
	context: MachineContext
): MachineContext['approachAttempts'] => {
	const id = context.combatTarget.entity?.id
	const attempt = id === undefined ? undefined : context.approachAttempts[id]
	if (id === undefined || !attempt || !canResumeApproach(context))
		return context.approachAttempts
	return {
		...context.approachAttempts,
		[id]: {
			...freshAttempt(),
			routeVisited: attempt.routeVisited,
			resumes: attempt.resumes + 1
		}
	}
}
