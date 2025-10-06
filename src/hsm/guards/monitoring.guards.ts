import { and, not, stateIn } from 'xstate'
import { PRIORITIES } from '../config/priorities.js'
import type { Entity } from '../../types/index.js'

const STATE_PATHS = {
	// URGENT_NEEDS
	EMERGENCY_HEALING: { MAIN_ACTIVITY: { URGENT_NEEDS: 'EMERGENCY_HEALING' } },
	EMERGENCY_EATING: { MAIN_ACTIVITY: { URGENT_NEEDS: 'EMERGENCY_EATING' } },

	// PEACEFUL
	FOLLOWING: { MAIN_ACTIVITY: { PEACEFUL: 'FOLLOWING' } },
	MINING: { MAIN_ACTIVITY: { PEACEFUL: 'MINING' } },
	BUILDING: { MAIN_ACTIVITY: { PEACEFUL: 'BUILDING' } },
	FARMING: { MAIN_ACTIVITY: { PEACEFUL: 'FARMING' } },
	SLEEPING: { MAIN_ACTIVITY: { PEACEFUL: 'SLEEPING' } },
	SHELTERING: { MAIN_ACTIVITY: { PEACEFUL: 'SHELTERING' } },
	IDLE: { MAIN_ACTIVITY: { PEACEFUL: 'IDLE' } },

	// COMBAT
	COMBAT: { MAIN_ACTIVITY: 'COMBAT' },
	FLEEING: { MAIN_ACTIVITY: { COMBAT: 'FLEEING' } },
	MELEE_ATTACKING: { MAIN_ACTIVITY: { COMBAT: 'MELEE_ATTACKING' } },
	RANGED_ATTACKING: { MAIN_ACTIVITY: { COMBAT: 'RANGED_ATTACKING' } },
	DEFENDING: { MAIN_ACTIVITY: { COMBAT: 'DEFENDING' } },

	// TASKS
	DEPOSIT_ITEMS: { MAIN_ACTIVITY: { TASKS: 'DEPOSIT_ITEMS' } },
	REPAIR_ARMOR_TOOLS: { MAIN_ACTIVITY: { TASKS: 'REPAIR_ARMOR_TOOLS' } }
}

function getHigherPriorityConditions(currentPriority: number): boolean {
	return Object.entries(PRIORITIES)
		.filter(([key, priority]) => priority > currentPriority)
		.filter(([key]) => STATE_PATHS[key]) // ✅ Только если путь известен
		.map(([key]) => not(stateIn(STATE_PATHS[key]))) // ✅ Используем правильный путь
}

const isHungerCritical = and([
	not(stateIn({ MAIN_ACTIVITY: { URGENT_NEEDS: 'EMERGENCY_EATING' } })),
	not(stateIn({ MAIN_ACTIVITY: { URGENT_NEEDS: 'EMERGENCY_HEALING' } })),
	...getHigherPriorityConditions(PRIORITIES.EMERGENCY_EATING),
	({ context, event }) => context.food < context.preferences.foodEmergency
])

const isHealthCritical = and([
	not(stateIn({ MAIN_ACTIVITY: { URGENT_NEEDS: 'EMERGENCY_HEALING' } })),
	not(stateIn({ MAIN_ACTIVITY: { URGENT_NEEDS: 'EMERGENCY_EATING' } })),
	...getHigherPriorityConditions(PRIORITIES.EMERGENCY_HEALING),
	({ context, event }) => context.health < context.preferences.healthEmergency
])

const isEnemyNearby = and([
	not(stateIn({ MAIN_ACTIVITY: 'COMBAT' })),
	...getHigherPriorityConditions(PRIORITIES.COMBAT),
	({ context, event }) => {
		if (!context.position || !context.enemies.length) return false
		return context.enemies.some(
			(enemy: Entity) =>
				enemy.position &&
				enemy.position.distanceTo(context.position) <=
					context.preferences.maxDistToEnemy
		)
	}
])

const isInventoryFull = and([
	not(stateIn({ MAIN_ACTIVITY: { TASKS: 'DEPOSIT_ITEMS' } })),
	...getHigherPriorityConditions(PRIORITIES.DEPOSIT_ITEMS),
	({ context, event }) =>
		context.inventory.length >= context.preferences.maxCountSlotsInInventory
])

const isBrokenArmorOrTools = and([
	not(stateIn({ MAIN_ACTIVITY: { TASKS: 'REPAIR_ARMOR_TOOLS' } })),
	...getHigherPriorityConditions(PRIORITIES.REPAIR_ARMOR_TOOLS),
	({ context, event }) =>
		Object.values({
			...context.toolDurability,
			...context.armorDurability
		}).some(durability => durability <= 10)
])

export default {
	isHungerCritical,
	isHealthCritical,
	isEnemyNearby,
	isInventoryFull,
	isBrokenArmorOrTools
}
