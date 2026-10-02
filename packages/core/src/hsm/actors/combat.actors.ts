import { Weapons } from 'minecrafthawkeye'

import type { Bot, Entity } from '@/types/index.js'

import Logger from '@/config/logger.js'

import type { MachineContext } from '@/hsm/context.js'
import {
	type BaseServiceState,
	type ServiceAPI,
	createStatefulService
} from '@/hsm/helpers/createStatefulService.js'
import type { MachineEvent } from '@/hsm/types.js'

import {
	getMeleeExitRange,
	hasRangedLoadout,
	resolveCombatTarget
} from '@/utils/combat/combatRange.js'
import { canSeeEnemy } from '@/utils/combat/enemyVisibility.js'
import {
	stopMeleeAttack,
	stopRangedAttack
} from '@/utils/combat/runtimeControl.js'

interface MeleeAttackState extends BaseServiceState {
	currentTarget: Entity | null
	ready: boolean
}

interface RangedSkirmishState extends BaseServiceState {
	currentTarget: Entity | null
	weaponType: Weapons | null
	weaponSlot: number | null
}

const logCombatRuntime = (event: string, payload: Record<string, unknown>) => {
	Logger.debug(`[COMBAT] ${event}`, payload)
}

const isPvpTargetActive = (bot: Bot, enemy: Entity) =>
	bot.pvp?.target?.id === enemy.id

const issueMeleeAttack = (
	bot: Bot,
	enemy: Entity,
	sendBack: (event: MachineEvent) => void
) => {
	const attackResult = bot.pvp.attack(enemy)

	if (attackResult instanceof Promise) {
		void attackResult.catch((error: unknown) => {
			Logger.error('[COMBAT] melee_attack_failed', {
				error:
					error instanceof Error
						? (error.stack ?? error.message)
						: String(error)
			})
			sendBack({
				type: 'ERROR',
				error: error instanceof Error ? error.message : String(error)
			})
		})
	}
}

const getWeaponType = (weaponName: string): Weapons => {
	if (weaponName.includes('crossbow')) return Weapons.crossbow
	return Weapons.bow
}

const resolveRangedLoadout = (bot: Bot) => {
	const weapon = bot.utils.getRangeWeapon()
	const arrows = bot.utils.getArrow()

	if (!weapon || !arrows) {
		return null
	}

	return {
		weapon,
		weaponType: getWeaponType(weapon.name)
	}
}

const canExitMeleeToRanged = (
	bot: Bot,
	context: MachineContext,
	target: { entity: Entity | null; distance: number }
) => {
	if (!target.entity) {
		return false
	}

	return (
		hasRangedLoadout(context) &&
		target.distance > getMeleeExitRange(context) &&
		target.distance <= context.preferences.rangedAttackRange &&
		canSeeEnemy(bot, target.entity)
	)
}

const updateMelee = ({
	context,
	state,
	bot,
	sendBack,
	setState,
	abortSignal
}: ServiceAPI<MeleeAttackState>) => {
	if (!state.ready || abortSignal.aborted) return
	const weapon = bot.utils.getMeleeWeapon()
	if (!weapon || bot.heldItem?.type !== weapon.type) {
		// Inventory availability is not permission to hit with an empty hand.
		// Re-enter through the HSM so the old controller stops before rearming.
		sendBack({ type: 'WEAPON_BROKEN' })
		return
	}
	const target = resolveCombatTarget(context)

	if (!target.entity) {
		if (state.currentTarget) {
			stopMeleeAttack(bot, 'no_enemies', logCombatRuntime)
			setState({ currentTarget: null })
		}

		sendBack({ type: 'NO_ENEMIES' })
		return
	}

	if (canExitMeleeToRanged(bot, context, target)) {
		if (state.currentTarget) {
			stopMeleeAttack(bot, 'switch_to_ranged', logCombatRuntime)
			setState({ currentTarget: null })
		}

		sendBack({ type: 'ENEMY_BECAME_FAR' })
		return
	}

	const enemy = target.entity
	sendBack({ type: 'APPROACH_SAMPLE' })
	if (abortSignal.aborted) return

	if (!state.currentTarget || state.currentTarget.id !== enemy.id) {
		if (state.currentTarget) {
			stopMeleeAttack(bot, 'retarget', logCombatRuntime)
		}

		issueMeleeAttack(bot, enemy, sendBack)
		setState({ currentTarget: enemy })
		logCombatRuntime('melee_attack_issued', {
			enemyId: enemy.id,
			distance: Number(target.distance.toFixed(2)),
			reason: 'target_changed'
		})
		return
	}

	if (!isPvpTargetActive(bot, enemy)) {
		issueMeleeAttack(bot, enemy, sendBack)
		logCombatRuntime('melee_attack_issued', {
			enemyId: enemy.id,
			distance: Number(target.distance.toFixed(2)),
			reason: 'controller_lost_target'
		})
	}
}

const serviceMeleeAttack = createStatefulService<MeleeAttackState>({
	name: 'MeleeAttack',
	operationTimeoutMs: 15_000,
	tickInterval: 500,
	initialState: { currentTarget: null, ready: false },
	onStart: async api => {
		const { bot, abortSignal, setState } = api
		bot.utils.stopEating?.()
		const meleeWeapon = bot.utils.getMeleeWeapon()
		if (meleeWeapon) {
			await bot.equip(meleeWeapon, 'hand', { signal: abortSignal })
			if (abortSignal.aborted) return
			Logger.debug(`Melee equipped: ${meleeWeapon.name}`)
		}
		setState({ ready: true })
		// Read the current target after equip: it may have changed while awaiting inventory.
		updateMelee(api)
	},
	onTick: updateMelee,

	onEvents: () => ({
		physicsTick: updateMelee,
		path_update: ({ sendBack }, result: { status?: string }) => {
			if (result.status === 'noPath' || result.status === 'timeout')
				sendBack({ type: 'APPROACH_ROUTE_FAILED' })
		}
	}),
	onCleanup: ({ bot, setState }) => {
		stopMeleeAttack(bot, 'cleanup', logCombatRuntime)
		setState({ currentTarget: null })
	}
})

/** Also runs during pending equip; it never starts another inventory operation. */
const checkRangedConditions = (api: ServiceAPI<RangedSkirmishState>) => {
	const { context, bot, sendBack, abortSignal } = api
	if (abortSignal.aborted) return null
	const target = resolveCombatTarget(context)
	if (!target.entity || !canSeeEnemy(bot, target.entity)) {
		sendBack({ type: 'NO_ENEMIES' })
		return null
	}
	if (target.distance > context.preferences.rangedAttackRange) {
		sendBack({ type: 'ENEMY_BECAME_FAR' })
		return null
	}
	if (target.distance <= context.preferences.enemyMeleeRange) {
		sendBack({ type: 'ENEMY_BECAME_CLOSE' })
		return null
	}
	const loadout = resolveRangedLoadout(bot)
	if (!loadout || context.rangedUnavailable) {
		sendBack({ type: 'WEAPON_BROKEN' })
		return null
	}
	// Slot sync replaces Item objects, including after durability changes. Only
	// actual equipment changes invalidate the firing controller and its draw.
	if (
		api.state.currentTarget &&
		(bot.heldItem?.type !== loadout.weapon.type ||
			api.state.weaponType !== loadout.weaponType ||
			api.state.weaponSlot !== bot.getEquipmentDestSlot('hand'))
	) {
		stopRangedAttack(bot, 'weapon_changed', logCombatRuntime)
		api.setState({ currentTarget: null, weaponType: null, weaponSlot: null })
	}
	return { enemy: target.entity, distance: target.distance, ...loadout }
}

const updateRanged = async (api: ServiceAPI<RangedSkirmishState>) => {
	const { bot, sendBack, setState, abortSignal } = api
	let candidate = checkRangedConditions(api)
	if (!candidate) return
	if (bot.heldItem?.type !== candidate.weapon.type) {
		try {
			await bot.equip(candidate.weapon, 'hand', { signal: abortSignal })
			if (abortSignal.aborted) return
		} catch (error) {
			sendBack({
				type: 'RANGED_UNAVAILABLE',
				reason: error instanceof Error ? error.message : String(error)
			})
			return
		}
		// Equip can outlive the target, its range, visibility, or the ammunition.
		candidate = checkRangedConditions(api)
		if (!candidate || bot.heldItem?.type !== candidate.weapon.type) return
	}
	const { enemy, distance, weapon, weaponType } = candidate
	const { state } = api
	if (state.currentTarget?.id === enemy.id && state.weaponType === weaponType)
		return
	// HawkEye owns the draw; changing aim must not release or restart it.
	bot.hawkEye.autoAttack(enemy, weaponType)
	setState({
		currentTarget: enemy,
		weaponType,
		weaponSlot: bot.getEquipmentDestSlot('hand')
	})
	logCombatRuntime('ranged_attack_issued', {
		enemyId: enemy.id,
		distance: Number(distance.toFixed(2)),
		weapon: weapon.name
	})
}

const serviceRangedSkirmish = createStatefulService<RangedSkirmishState>({
	name: 'RangedSkirmish',
	operationTimeoutMs: 15_000,
	asyncTickInterval: 250,
	initialState: { currentTarget: null, weaponType: null, weaponSlot: null },
	onStart: async api => {
		api.bot.utils.stopEating?.()
		await updateRanged(api)
	},
	onAsyncTick: updateRanged,
	onEvents: () => ({
		physicsTick: api => {
			checkRangedConditions(api)
		}
	}),

	onCleanup: ({ bot, setState }) => {
		stopRangedAttack(bot, 'cleanup', logCombatRuntime)
		setState({ currentTarget: null, weaponType: null, weaponSlot: null })
	}
})

const serviceRangedAttack = serviceRangedSkirmish

export default {
	serviceMeleeAttack,
	serviceRangedAttack,
	serviceRangedSkirmish
}
