import type { Entity } from '@/types'

import {
	type BaseServiceState,
	createStatefulService
} from '@/hsm/helpers/createStatefulService.js'
import { GoalNear, GoalXZ } from '@/modules/plugins/goals.js'
import { hasMovementController } from '@/utils/combat/movementController'
import {
	clearMicroMovement,
	enableMicroMovement,
	stopMeleeAttack,
	stopPathfinderMovement,
	stopRangedAttack
} from '@/utils/combat/runtimeControl'
import {
	calculateDangerCenter,
	canFleeToPlayer,
	resolveSurvivalThreat,
	SURVIVAL_MOVEMENT_DISTANCE,
	type SurvivalMode
} from '@/utils/combat/survival'

interface EmergencyRecoveryState extends BaseServiceState {
	mode: SurvivalMode
	lastPathGoalKey: string | null
	lastPathGoalIssuedAt: number
}

const pathGoalReissueMs = 750

const logSurvivalRuntime = (event: string, payload: Record<string, unknown>) => {
	console.log(`[SURVIVAL] ${event}`, JSON.stringify(payload))
}

const setMode = (
	state: EmergencyRecoveryState,
	setState: (updates: Partial<EmergencyRecoveryState>) => void,
	sendBack: (event: any) => void,
	mode: SurvivalMode
) => {
	if (state.mode === mode) {
		return
	}

	setState({ mode })
	sendBack({ type: 'SURVIVAL_MODE_CHANGED', mode })
}

const stopCombatControllers = (bot: any) => {
	stopMeleeAttack(bot, 'urgent_survival')
	stopRangedAttack(bot, 'urgent_survival')
}

const resetMovementForEating = (
	bot: any,
	state: EmergencyRecoveryState,
	setState: (updates: Partial<EmergencyRecoveryState>) => void
) => {
	clearMicroMovement(bot)
	stopPathfinderMovement(bot)
	setState({
		lastPathGoalKey: null,
		lastPathGoalIssuedAt: 0
	})
}

const ensurePathfinderMode = (bot: any) => {
	clearMicroMovement(bot)

	if (bot.movements) {
		bot.movements.allowSprinting = true
		if (typeof bot.pathfinder?.setMovements === 'function') {
			bot.pathfinder.setMovements(bot.movements)
		}
	}
}

const getDangerCenter = (bot: any, context: any) => {
	const position = context.position ?? bot.entity?.position ?? null
	return calculateDangerCenter(position, context.enemies)
}

const getFleeYaw = (position: any, dangerCenter: any): number | null => {
	if (!position || !dangerCenter) {
		return null
	}

	return Math.atan2(position.x - dangerCenter.x, position.z - dangerCenter.z)
}

const applyMovementFleeSteering = (bot: any, context: any) => {
	const position = context.position ?? bot.entity?.position ?? null
	const dangerCenter = getDangerCenter(bot, context)
	const yaw = getFleeYaw(position, dangerCenter)

	if (yaw === null) {
		return false
	}

	enableMicroMovement(bot)

	if (typeof bot.look === 'function') {
		void bot.look(yaw, bot.entity?.pitch ?? 0, true)
	}

	if (hasMovementController(bot)) {
		bot.movement.setGoal(bot.movement.goals.Default)
		bot.movement.heuristic.get('proximity').target(dangerCenter).avoid(true)
		void bot.movement.steer(yaw, true)
	}

	return true
}

const activateMovementFlee = ({
	bot,
	context,
	state,
	setState,
	sendBack
}: {
	bot: any
	context: any
	state: EmergencyRecoveryState
	setState: (updates: Partial<EmergencyRecoveryState>) => void
	sendBack: (event: any) => void
}) => {
	const position = context.position ?? bot.entity?.position ?? null
	const dangerCenter = getDangerCenter(bot, context)

	if (!dangerCenter) {
		return false
	}

	stopPathfinderMovement(bot)
	if (!applyMovementFleeSteering(bot, context)) {
		return false
	}

	setMode(state, setState, sendBack, 'MOVEMENT')
	setState({
		lastPathGoalKey: null,
		lastPathGoalIssuedAt: 0
	})
	logSurvivalRuntime('movement_flee', {
		distance: Number(resolveSurvivalThreat(context).distance.toFixed(2))
	})
	return true
}

const issuePathfinderGoal = ({
	bot,
	state,
	setState,
	key,
	goal
}: {
	bot: any
	state: EmergencyRecoveryState
	setState: (updates: Partial<EmergencyRecoveryState>) => void
	key: string
	goal: unknown
}) => {
	const now = Date.now()
	if (
		state.lastPathGoalKey === key &&
		now - state.lastPathGoalIssuedAt < pathGoalReissueMs
	) {
		return
	}

	bot.pathfinder.setGoal(goal)
	setState({
		lastPathGoalKey: key,
		lastPathGoalIssuedAt: now
	})
}

const activatePlayerEscape = ({
	bot,
	context,
	state,
	setState,
	sendBack,
	player
}: {
	bot: any
	context: any
	state: EmergencyRecoveryState
	setState: (updates: Partial<EmergencyRecoveryState>) => void
	sendBack: (event: any) => void
	player: Entity
}) => {
	ensurePathfinderMode(bot)
	setMode(state, setState, sendBack, 'PATHFINDER')

	issuePathfinderGoal({
		bot,
		state,
		setState,
		key: `player:${player.id}`,
		goal: new GoalNear(player.position.x, player.position.y, player.position.z, 3)
	})

	logSurvivalRuntime('flee_to_player', {
		playerId: player.id,
		playerName: player.username ?? player.name ?? 'unknown'
	})
}

const activatePathfinderFlee = ({
	bot,
	context,
	state,
	setState,
	sendBack
}: {
	bot: any
	context: any
	state: EmergencyRecoveryState
	setState: (updates: Partial<EmergencyRecoveryState>) => void
	sendBack: (event: any) => void
}) => {
	const threat = resolveSurvivalThreat(context)
	const position = context.position ?? bot.entity?.position ?? null

	if (!threat.entity || !position) {
		return
	}

	const dangerCenter =
		calculateDangerCenter(position, context.enemies) ?? threat.entity.position
	const deltaX = position.x - dangerCenter.x
	const deltaZ = position.z - dangerCenter.z
	const planarDistance = Math.hypot(deltaX, deltaZ)
	const directionX = planarDistance > 0.001 ? deltaX / planarDistance : 1
	const directionZ = planarDistance > 0.001 ? deltaZ / planarDistance : 0
	const fleeTargetX = position.x + directionX * context.preferences.fleeTargetDistance
	const fleeTargetZ = position.z + directionZ * context.preferences.fleeTargetDistance
	const goalX = Math.floor(fleeTargetX)
	const goalZ = Math.floor(fleeTargetZ)

	ensurePathfinderMode(bot)
	setMode(state, setState, sendBack, 'PATHFINDER')
	issuePathfinderGoal({
		bot,
		state,
		setState,
		key: `flee:${threat.entity.id}:${goalX}:${goalZ}`,
		goal: new GoalXZ(goalX, goalZ)
	})

	logSurvivalRuntime('pathfinder_flee', {
		enemyId: threat.entity.id,
		distance: Number(threat.distance.toFixed(2)),
		to: {
			x: goalX,
			z: goalZ
		}
	})
}

const activateEatingRecovery = ({
	bot,
	state,
	setState,
	sendBack
}: {
	bot: any
	state: EmergencyRecoveryState
	setState: (updates: Partial<EmergencyRecoveryState>) => void
	sendBack: (event: any) => void
}) => {
	resetMovementForEating(bot, state, setState)
	setMode(state, setState, sendBack, 'EATING')
	void bot.utils.eating()
}

const createEmergencyRecoveryService = (kind: 'health' | 'food') =>
	createStatefulService<EmergencyRecoveryState>({
		name: kind === 'health' ? 'EmergencyHealing' : 'EmergencyEating',
		tickInterval: 100,
		initialState: {
			mode: 'IDLE',
			lastPathGoalKey: null,
			lastPathGoalIssuedAt: 0
		},

		onStart: ({ bot, state, setState, sendBack }) => {
			stopCombatControllers(bot)
			bot.utils.stopEating?.()

			if (bot.movements) {
				bot.movements.allowSprinting = true
			}

			setMode(state, setState, sendBack, 'IDLE')
		},

		onTick: ({ bot, context, state, setState, sendBack }) => {
			const restored =
				kind === 'health'
					? context.health >= context.preferences.healthFullyRestored
					: context.food >= context.preferences.foodRestored

			if (restored) {
				resetMovementForEating(bot, state, setState)
				bot.utils.stopEating?.()
				setMode(state, setState, sendBack, 'IDLE')
				sendBack({
					type: kind === 'health' ? 'HEALTH_RESTORED' : 'FOOD_RESTORED'
				})
				return
			}

			const threat = resolveSurvivalThreat(context)
			const position = context.position ?? bot.entity?.position ?? null
			const player = bot.utils.searchPlayer?.() ?? null

			if (
				threat.entity &&
				canFleeToPlayer(context, position, player) &&
				threat.distance < context.preferences.safeEatDistance
			) {
				bot.utils.stopEating?.()
				activatePlayerEscape({
					bot,
					context,
					state,
					setState,
					sendBack,
					player
				})
				return
			}

			if (threat.entity && threat.distance < SURVIVAL_MOVEMENT_DISTANCE) {
				bot.utils.stopEating?.()
				const moved = activateMovementFlee({
					bot,
					context,
					state,
					setState,
					sendBack
				})

				if (!moved) {
					activatePathfinderFlee({
						bot,
						context,
						state,
						setState,
						sendBack
					})
				}
				return
			}

			if (
				threat.entity &&
				threat.distance < context.preferences.safeEatDistance
			) {
				bot.utils.stopEating?.()
				activatePathfinderFlee({
					bot,
					context,
					state,
					setState,
					sendBack
				})
				return
			}

			activateEatingRecovery({
				bot,
				state,
				setState,
				sendBack
			})
		},

		onCleanup: ({ bot, state, setState }) => {
			resetMovementForEating(bot, state, setState)
			bot.utils.stopEating?.()
		},

		onEvents: () => ({
			physicsTick: (api: {
				bot: any
				state: EmergencyRecoveryState
				getContext: () => any
			}) => {
				if (api.state.mode !== 'MOVEMENT') {
					return
				}

				applyMovementFleeSteering(api.bot, api.getContext())
			}
		})
	})

const serviceEmergencyHealing = createEmergencyRecoveryService('health')
const serviceEmergencyEating = createEmergencyRecoveryService('food')

export default {
	serviceEmergencyHealing,
	serviceEmergencyEating
}
