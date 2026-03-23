import { and, not, stateIn } from 'xstate'

import type { MachineGuardParams } from '@hsm/types'
import { getHigherPriorityConditions } from '@hsm/utils/getPriority.js'

const isHungerCritical = and([
	not(stateIn({ MAIN_ACTIVITY: { URGENT_NEEDS: 'EMERGENCY_EATING' } })),
	not(stateIn({ MAIN_ACTIVITY: { URGENT_NEEDS: 'EMERGENCY_HEALING' } })),
	({ context, event }: MachineGuardParams) =>
		getHigherPriorityConditions(context, 'EMERGENCY_EATING'),
	({ context, event }: MachineGuardParams) =>
		context.food < context.preferences.foodEmergency
])

const isHealthCritical = and([
	not(stateIn({ MAIN_ACTIVITY: { URGENT_NEEDS: 'EMERGENCY_HEALING' } })),
	not(stateIn({ MAIN_ACTIVITY: { URGENT_NEEDS: 'EMERGENCY_EATING' } })),
	({ context, event }: MachineGuardParams) =>
		getHigherPriorityConditions(context, 'EMERGENCY_HEALING'),
	({ context, event }) => context.health < context.preferences.healthEmergency
])

const isEnemyNearby = and([
	not(stateIn({ MAIN_ACTIVITY: 'COMBAT' })),
	({ context, event }: MachineGuardParams) =>
		getHigherPriorityConditions(context, 'COMBAT'),
	({ context, event }) => context.nearestEnemy.entity !== null
])

const isInventoryFull = and([
	not(stateIn({ MAIN_ACTIVITY: { TASKS: 'DEPOSIT_ITEMS' } })),
	({ context, event }: MachineGuardParams) =>
		getHigherPriorityConditions(context, 'DEPOSIT_ITEMS'),
	({ context, event }: MachineGuardParams) =>
		context.inventory.length >= context.preferences.maxCountSlotsInInventory
])

const isBrokenArmorOrTools = and([
	not(stateIn({ MAIN_ACTIVITY: { TASKS: 'REPAIR_ARMOR_TOOLS' } })),
	({ context, event }: MachineGuardParams) =>
		getHigherPriorityConditions(context, 'REPAIR_ARMOR_TOOLS'),
	({ context, event }: MachineGuardParams) =>
		Object.values({
			...context.toolDurability,
			...context.armorDurability
		}).some(durability => durability || 0 <= 10)
])

export default {
	isHungerCritical,
	isHealthCritical,
	isEnemyNearby,
	isInventoryFull,
	isBrokenArmorOrTools
}
