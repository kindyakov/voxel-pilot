import type { Block, Bot } from '@/types/index.js'

export interface MiningResource {
	itemName: string
	itemId: number
	blockNames: string[]
	silkTouch: 'required' | 'forbidden' | 'allowed'
}

const ORE_DROPS: Readonly<Record<string, string>> = {
	coal_ore: 'coal',
	iron_ore: 'raw_iron',
	copper_ore: 'raw_copper',
	gold_ore: 'raw_gold',
	diamond_ore: 'diamond',
	emerald_ore: 'emerald',
	lapis_ore: 'lapis_lazuli',
	redstone_ore: 'redstone',
	nether_quartz_ore: 'quartz',
	nether_gold_ore: 'gold_nugget'
}

const dropId = (drop: NonNullable<Block['drops']>[number]): number =>
	typeof drop === 'number'
		? drop
		: typeof drop.drop === 'number'
			? drop.drop
			: drop.drop.id

/** Resolve a concrete output, never interpret the player's natural language here. */
export function resolveMiningResource(
	bot: Pick<Bot, 'registry'>,
	blockName: string,
	requestedItem?: string
): MiningResource {
	const source = bot.registry.blocksByName[blockName]
	if (!source) throw new Error(`Unknown mining block: ${blockName}`)
	if (source.diggable === false)
		throw new Error(`Block cannot be mined: ${blockName}`)
	const base = blockName.replace(/^deepslate_/, '')
	const normalDrop = ORE_DROPS[base]
	const firstDrop = source.drops?.[0]
	const legacyItem =
		firstDrop === undefined
			? undefined
			: bot.registry.items[dropId(firstDrop)]?.name
	const itemName = requestedItem ?? normalDrop ?? legacyItem ?? blockName
	const item = bot.registry.itemsByName[itemName]
	if (!item) throw new Error(`Unknown mining resource: ${itemName}`)
	const normalDrops = (source.drops ?? []).map(dropId)
	const isNormalDrop = normalDrop
		? normalDrop === itemName
		: normalDrops.includes(item.id)
	if (!isNormalDrop && itemName !== blockName) {
		throw new Error(`${blockName} cannot supply ${itemName}`)
	}
	const blockNames = [blockName]
	if (normalDrop === itemName && !base.startsWith('nether_')) {
		for (const name of [base, `deepslate_${base}`]) {
			if (bot.registry.blocksByName[name] && !blockNames.includes(name))
				blockNames.push(name)
		}
	}
	return {
		itemName,
		itemId: item.id,
		blockNames,
		silkTouch: !isNormalDrop
			? 'required'
			: itemName !== blockName
				? 'forbidden'
				: 'allowed'
	}
}
