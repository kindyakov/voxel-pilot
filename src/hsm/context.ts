import type { Bot, Vec3, Entity, Item } from '@types'
import type { AnyTaskData, Plan } from '@hsm/tasks/types'

export interface MachineContext {
	bot: Bot | null
	health: number
	food: number
	oxygenLevel: number
	foodSaturation: number

	weather: string | null
	timeOfDay: number | null
	entities: Entity[]
	enemies: Entity[]
	players: Entity[]

	// Инвентарь и экипировка
	inventory: Item[]
	toolDurability: {
		pickaxe: number | null
		sword: number | null
		axe: number | null
		shield: number | null
	}
	armorDurability: {
		helmet: number | null
		chestplate: number | null
		leggings: number | null
		boots: number | null
	}

	position: Vec3 | null
	spawn: Vec3 | null
	home: Vec3 | null

	preferences: {
		autoEat: boolean
		autoDefend: boolean
		followDistance: number
		maxDistToEnemy: number
		maxObservDist: number
		combatMode: 'defensive' | 'attack' | 'retreat'

		// FLEEING distances
		safeEatDistance: number
		fleeTargetDistance: number
		safePlayerDistance: number
		fleeToPlayerRadius: number

		enemyMeleeRange: number
		enemyRangedRange: number

		maxCountSlotsInInventory: number

		// Пороги для EMERGENCY_EATING
		foodEmergency: number
		foodRestored: number

		// Пороги для EMERGENCY_HEALING
		healthEmergency: number
		healthFullyRestored: number
	}

	nearestEnemy: {
		entity: Entity | null
		distance: number
	}

	taskData: AnyTaskData | null
	plan: Plan | null
	pausedPlan: Plan | null // Прерванный план
	savedTaskState: null // Сохранённое состояние задачи
}

export const context: MachineContext = {
	bot: null,
	// Жизненные показатели
	health: 20,
	food: 20,
	oxygenLevel: 20,
	foodSaturation: 5,

	// Окружение
	weather: null,
	timeOfDay: null,
	entities: [],
	enemies: [],
	players: [],

	// Инвентарь и экипировка
	inventory: [],
	toolDurability: {
		pickaxe: null,
		sword: null,
		axe: null,
		shield: null
	},
	armorDurability: {
		helmet: null,
		chestplate: null,
		leggings: null,
		boots: null
	},

	// Позиция и навигация
	position: null,
	spawn: null,
	home: null,

	// Настройки поведения
	preferences: {
		autoEat: true,
		autoDefend: true,
		followDistance: 3,
		maxDistToEnemy: 20,
		maxObservDist: 50,
		combatMode: 'defensive',

		// FLEEING distances
		safeEatDistance: 20,
		fleeTargetDistance: 15,
		safePlayerDistance: 10,
		fleeToPlayerRadius: 50,

		enemyMeleeRange: 5,
		enemyRangedRange: 8,

		maxCountSlotsInInventory: 45,

		// Пороги для EMERGENCY_EATING
		foodEmergency: 15,
		foodRestored: 20,

		// Пороги для EMERGENCY_HEALING
		healthEmergency: 10,
		healthFullyRestored: 18
	},

	nearestEnemy: {
		entity: null,
		distance: Infinity
	},

	plan: null, // Текущий план
	taskData: null, //  данные текущей задачи
	pausedPlan: null, // Прерванный план
	savedTaskState: null // Сохранённое состояние задачи
}
