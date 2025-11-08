import type { PrimitiveType } from '@/hsm/actors/primitives/index.primitive'

type RequiredParamsType = 'blockName' | 'entityName' | 'target'
type OptionalParamsType = 'maxDistance' | 'count' | 'distance'

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
	}
} as const
