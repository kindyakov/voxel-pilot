import type { Entity, EntityType } from '@/types'

export function isEntityOfType(entity: Entity, type: EntityType = 'hostile') {
	return entity.type === type
}
