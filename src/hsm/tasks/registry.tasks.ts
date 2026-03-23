import type { PrimitiveType } from '@/hsm/actors/primitives/index.primitive'

type TaskType =
	| 'MINING'
	| 'SMELTING'
	| 'CRAFTING'
	| 'BUILDING'
	| 'FARMING'
	| 'FOLLOWING'

type RequiredParamsType =
	| 'blockName'
	| 'count'
	| 'inputItem'
	| 'outputItem'
	| 'recipe'

type OptionalParamsType = ''

interface PreconditionsType {
	tool?: string
	inventory_space?: boolean
	furnace?: 'nearby'
}

interface TaskRegistryItem {
	name: TaskType
	description: string
	required_params: string[]
	optional_params?: string[]
	primitives_used: PrimitiveType[]
	preconditions: PreconditionsType
}

export const TASK_REGISTRY: Record<TaskType, TaskRegistryItem> = {
	MINING: {
		name: 'MINING',
		description: 'Добыча блоков',
		required_params: ['blockName', 'count'],
		optional_params: ['maxDistance'],
		primitives_used: [
			'primitiveSearchBlock',
			'primitiveNavigating',
			'primitiveBreaking'
		],
		preconditions: {
			tool: 'pickaxe',
			inventory_space: true
		}
	},
	SMELTING: {
		name: 'SMELTING',
		description: 'Плавка предметов',
		required_params: ['inputItem', 'outputItem', 'count'],
		primitives_used: ['primitiveNavigating'],
		preconditions: {
			furnace: 'nearby',
			inventory_space: true
		}
	},
	CRAFTING: {
		name: 'CRAFTING',
		description: 'Создание предметов по рецепту',
		required_params: ['recipe', 'count'],
		primitives_used: ['primitiveNavigating'],
		preconditions: {
			inventory_space: true
		}
	},
	BUILDING: {
		name: 'BUILDING',
		description: 'Стоительство',
		required_params: ['count'],
		primitives_used: ['primitiveNavigating'],
		preconditions: {
			inventory_space: true
		}
	},
	FARMING: {
		name: 'FARMING',
		description: 'Сбор урожая',
		required_params: ['count'],
		primitives_used: ['primitiveNavigating'],
		preconditions: {
			inventory_space: true
		}
	},
	FOLLOWING: {
		name: 'FOLLOWING',
		description: 'Следование за игроком или сущностью',
		required_params: [], // Хотя бы один из targetPlayerName, entityName, entityType должен быть указан
		optional_params: ['entityName', 'entityType', 'distance', 'maxDistance'],
		primitives_used: ['primitiveSearchEntity', 'primitiveFollowing'],
		preconditions: {} // Нет особых требований
	}
} as const
