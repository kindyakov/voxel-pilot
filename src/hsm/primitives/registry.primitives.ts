import type { PrimitiveType } from '@/hsm/actors/primitives/index.primitive'

interface PrimitiveDefinition {
	name: PrimitiveType // Имя service
	description: string // Описание
	required_params: string[] // Обязательные параметры
	optional_params?: string[] // Опциональные параметры
	events_emitted: string[] // Какие события отправляет
}

export const PRIMITIVE_REGISTRY: Record<string, PrimitiveDefinition> = {
	searchBlock: {
		name: 'primitiveSearchBlock',
		description: 'Поиск блоков в мире',
		required_params: ['blockName'],
		optional_params: ['maxDistance'],
		events_emitted: ['FOUND', 'NOT_FOUND']
	},
	searchEntity: {
		name: 'primitiveSearchEntity',
		description: 'Поиск сущностей в мире',
		required_params: ['entityName'],
		optional_params: ['maxDistance'],
		events_emitted: ['FOUND', 'NOT_FOUND']
	},
	navigate: {
		name: 'primitiveNavigating',
		description: 'Навигация к цели',
		required_params: ['target'],
		optional_params: ['distance'],
		events_emitted: ['ARRIVED', 'NAVIGATION_FAILED']
	},
	breaking: {
		name: 'primitiveBreaking',
		description: 'Ломает блок и собирает дроп',
		required_params: ['block'],
		optional_params: [],
		events_emitted: ['BROKEN', 'BREAKING_FAILED']
	},
	openContainer: {
		name: 'primitiveOpenContainer',
		description: 'Открытие контейнеров (сундуки, печи, верстаки и т.д.)',
		required_params: ['block'],
		optional_params: [],
		events_emitted: ['OPENED', 'OPEN_FAILED']
	},
	craft: {
		name: 'primitiveCraft',
		description: 'Крафт предметов в инвентаре (2x2 сетка)',
		required_params: ['itemName'],
		optional_params: ['count'],
		events_emitted: ['CRAFTED', 'CRAFT_FAILED']
	},
	craftInWorkbench: {
		name: 'primitiveCraftInWorkbench',
		description: 'Крафт предметов в верстаке (3x3 сетка)',
		required_params: ['itemName', 'craftingTable'],
		optional_params: ['count'],
		events_emitted: ['CRAFTED', 'CRAFT_FAILED']
	},
	smelt: {
		name: 'primitiveSmelt',
		description: 'Плавка ресурсов в печи',
		required_params: ['inputItemName', 'furnace'],
		optional_params: ['fuelItemName', 'count'],
		events_emitted: ['SMELTED', 'SMELT_FAILED']
	},
	placing: {
		name: 'primitivePlacing',
		description: 'Размещение блоков в мире',
		required_params: ['blockName', 'position'],
		optional_params: ['faceVector'],
		events_emitted: ['PLACED', 'PLACING_FAILED']
	},
	following: {
		name: 'primitiveFollowing',
		description: 'Следование за целью (сущность/игрок/позиция) используя movement',
		required_params: ['target'],
		optional_params: ['distance'],
		events_emitted: ['FOLLOWING_STOPPED', 'FOLLOWING_FAILED']
	}
} as const
