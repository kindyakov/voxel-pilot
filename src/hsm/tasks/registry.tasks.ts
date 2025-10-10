import type { PrimitiveType } from '@/hsm/actors/primitives/index.primitive'

type TaskType = 'MINING' | 'SMELTING' | 'CRAFTING' | 'BUILDING' | 'FARMING'

type RequiredParamsType =
	| 'ore'
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
		required_params: ['ore', 'count'],
		primitives_used: ['primitiveSearchBlock', 'primitiveNavigating'],
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
	}
} as const
