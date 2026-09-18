import type { Block, Bot, Item } from '@/types/index.js'

import type { MiningResource } from '@/hsm/tasks/miningResource.js'

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null

/** prismarine-item returns raw component data on 1.20.5+, despite its array type. */
const enchantmentsOf = (
	item: Item | null,
	registry: Bot['registry']
): { name: string; lvl: number }[] => {
	if (!item) return []
	const raw: unknown = item.enchants
	const values: unknown = Array.isArray(raw)
		? raw
		: isRecord(raw)
			? raw.enchantments
			: undefined
	if (!Array.isArray(values))
		throw new Error(`Invalid enchantments on ${item.name}`)
	return values.map((value: unknown) => {
		if (!isRecord(value)) throw new Error(`Invalid enchantment on ${item.name}`)
		const name =
			typeof value.name === 'string'
				? value.name.replace(/^minecraft:/, '')
				: typeof value.id === 'number'
					? registry.enchantments[value.id]?.name
					: undefined
		const lvl = value.lvl ?? value.level
		if (!name || typeof lvl !== 'number' || !Number.isInteger(lvl) || lvl < 0)
			throw new Error(`Invalid enchantment on ${item.name}`)
		return { name, lvl }
	})
}

/** Select among harvest-capable tools before equipping, including the empty hand. */
export async function equipMiningTool(
	bot: Pick<Bot, 'registry' | 'heldItem' | 'equip' | 'unequip'> & {
		inventory: Pick<Bot['inventory'], 'items'>
	},
	block: Block,
	resource: MiningResource
): Promise<void> {
	const candidates = [null, ...bot.inventory.items()].filter(item => {
		if (item?.name.endsWith('_sword') && block.name !== 'cobweb') return false
		if (!block.canHarvest(item?.type ?? null)) return false
		const silk = enchantmentsOf(item, bot.registry).some(
			enchant => enchant.name === 'silk_touch' && enchant.lvl > 0
		)
		return (
			resource.silkTouch === 'allowed' ||
			silk === (resource.silkTouch === 'required')
		)
	})
	candidates.sort(
		(a, b) =>
			block.digTime(
				a?.type ?? null,
				false,
				false,
				false,
				enchantmentsOf(a, bot.registry)
			) -
			block.digTime(
				b?.type ?? null,
				false,
				false,
				false,
				enchantmentsOf(b, bot.registry)
			)
	)
	const tool = candidates[0]
	if (tool === undefined)
		throw new Error(
			`No harvest tool for ${block.name} → ${resource.itemName} (Silk Touch ${resource.silkTouch})`
		)
	if (tool === null) {
		if (bot.heldItem) await bot.unequip('hand')
	} else if (bot.heldItem !== tool) await bot.equip(tool, 'hand')
}
