import type { Entity, EntityType } from '@/types/index.js'

export function isEntityOfType(entity: Entity, type: EntityType = 'hostile') {
	return entity.type === type
}
