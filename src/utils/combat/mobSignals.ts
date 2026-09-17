import type { Bot, Entity } from '@/types/index.js'

/** Never assume metadata offsets across protocol versions. */
export const readMobMetadata = (
	bot: Bot,
	entity: Entity,
	key: string
): unknown => {
	if (!entity.name) return undefined
	const keys: unknown =
		bot.registry?.entitiesByName?.[entity.name]?.metadataKeys
	if (!Array.isArray(keys)) return undefined
	const index = keys.indexOf(key)
	return index < 0 ? undefined : entity.metadata?.[index]
}

export const readCreeperSignals = (bot: Bot, entity: Entity) => {
	const direction = readMobMetadata(bot, entity, 'swell_dir')
	const ignited = readMobMetadata(bot, entity, 'is_ignited')
	const powered = readMobMetadata(bot, entity, 'is_powered')
	return {
		swelling: direction === 1 ? true : direction === -1 ? false : null,
		ignited: typeof ignited === 'boolean' ? ignited : null,
		powered: typeof powered === 'boolean' ? powered : null
	}
}
