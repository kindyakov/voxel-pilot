import type { Bot } from '@/types'

import type { MemoryPosition } from '@/core/memory/types.js'

export type WindowKind =
	| 'player_inventory'
	| 'generic_container'
	| 'furnace_family'
	| 'crafting_table'

export type WindowZone =
	| 'player_inventory'
	| 'hotbar'
	| 'container'
	| 'input'
	| 'fuel'
	| 'output'

export interface WindowItemSnapshot {
	name: string
	count: number
	maxDurability?: number | null
	durabilityUsed?: number | null
}

export interface WindowZoneSnapshot {
	zone: WindowZone
	items: WindowItemSnapshot[]
}

export interface WindowSnapshot {
	kind: WindowKind
	blockName: string | null
	position: MemoryPosition | null
	zones: WindowZoneSnapshot[]
}

export interface WindowDescriptor {
	kind: WindowKind
	label: string
	openWindow: (bot: Bot, block?: any) => Promise<any>
	resolveZones: (slotCount: number) => Record<WindowZone, number[]>
}

export interface WindowSession {
	kind: WindowKind
	descriptor: WindowDescriptor
	window: any
	blockName: string | null
	position: MemoryPosition | null
	openedAt: string
}

export interface WindowTransferRequest {
	sourceZone: WindowZone
	destZone: WindowZone
	itemName: string
	count: number
}

export interface WindowTransferResult {
	sourceZone: WindowZone
	destZone: WindowZone
	itemName: string
	count: number
}

export interface WindowCloseResult {
	ok: boolean
	reason?: string
}

const GENERIC_CONTAINER_BLOCK_NAMES = new Set([
	'barrel',
	'chest',
	'trapped_chest',
	'ender_chest',
	'hopper',
	'dispenser',
	'dropper'
])

const WINDOW_ZONE_ORDER: WindowZone[] = [
	'container',
	'input',
	'fuel',
	'output',
	'player_inventory',
	'hotbar'
]

const range = (start: number, end: number): number[] => {
	const result: number[] = []
	for (let index = start; index < end; index += 1) {
		result.push(index)
	}
	return result
}

const normalizeItems = (items: any[]): WindowItemSnapshot[] =>
	items.filter(Boolean).map(item => ({
		name: item.name,
		count: item.count,
		maxDurability: item.maxDurability ?? null,
		durabilityUsed: item.durabilityUsed ?? null
	}))

const buildZoneSnapshots = (
	slots: any[],
	zoneSlots: Record<WindowZone, number[]>
): WindowZoneSnapshot[] =>
	WINDOW_ZONE_ORDER.map(zone => {
		const indexes = zoneSlots[zone] ?? []
		const items = normalizeItems(
			indexes.map(index => slots[index]).filter(Boolean)
		)

		return {
			zone,
			items
		}
	})

const toRange = (slots: number[]): { start: number; end: number } | null => {
	if (slots.length === 0) {
		return null
	}

	return {
		start: slots[0] ?? 0,
		end: (slots[slots.length - 1] ?? 0) + 1
	}
}

const createDescriptor = (
	kind: WindowKind,
	label: string,
	openWindow: (bot: Bot, block?: any) => Promise<any>,
	resolveZones: (slotCount: number) => Record<WindowZone, number[]>
): WindowDescriptor => ({
	kind,
	label,
	openWindow,
	resolveZones
})

export const inferWindowKindFromBlockName = (
	blockName: string
): WindowKind | null => {
	const normalized = blockName.toLowerCase()

	if (
		normalized.includes('furnace') ||
		normalized.includes('blast_furnace') ||
		normalized.includes('smoker')
	) {
		return 'furnace_family'
	}

	if (normalized.includes('crafting_table')) {
		return 'crafting_table'
	}

	if (
		GENERIC_CONTAINER_BLOCK_NAMES.has(normalized) ||
		normalized.endsWith('_shulker_box')
	) {
		return 'generic_container'
	}

	return null
}

export const getWindowDescriptor = (kind: WindowKind): WindowDescriptor => {
	switch (kind) {
		case 'player_inventory':
			return createDescriptor(
				kind,
				'player inventory',
				async bot => bot.inventory,
				slotCount => ({
					container: [],
					input: [],
					fuel: [],
					output: [],
					player_inventory: range(9, Math.min(36, slotCount)),
					hotbar: range(36, Math.min(45, slotCount))
				})
			)
		case 'furnace_family':
			return createDescriptor(
				kind,
				'furnace family',
				async (bot, block) => bot.openFurnace(block),
				slotCount => ({
					container: [],
					input: [0],
					fuel: [1],
					output: [2],
					player_inventory: range(3, Math.max(3, slotCount - 9)),
					hotbar: range(Math.max(3, slotCount - 9), Math.max(3, slotCount))
				})
			)
		case 'crafting_table':
			return createDescriptor(
				kind,
				'crafting table',
				async (bot, block) => bot.openBlock(block),
				slotCount => ({
					container: range(0, Math.min(9, slotCount)),
					input: [],
					fuel: [],
					output: [9],
					player_inventory: range(10, Math.max(10, slotCount - 9)),
					hotbar: range(Math.max(10, slotCount - 9), Math.max(10, slotCount))
				})
			)
		case 'generic_container':
		default:
			return createDescriptor(
				kind,
				'generic container',
				async (bot, block) => bot.openContainer(block),
				slotCount => {
					const containerSlots = Math.max(0, slotCount - 36)
					const playerInventoryStart = containerSlots
					const hotbarStart = playerInventoryStart + 27

					return {
						container: range(0, containerSlots),
						input: [],
						fuel: [],
						output: [],
						player_inventory: range(
							playerInventoryStart,
							Math.min(hotbarStart, slotCount)
						),
						hotbar: range(hotbarStart, Math.min(hotbarStart + 9, slotCount))
					}
				}
			)
	}
}

export const openWindowSession = async (
	bot: Bot,
	block: any,
	position: MemoryPosition | null = null
): Promise<WindowSession> => {
	const kind = inferWindowKindFromBlockName(block.name)
	if (!kind) {
		throw new Error(`Unsupported window block: ${block.name}`)
	}

	const descriptor = getWindowDescriptor(kind)
	const window = await descriptor.openWindow(bot, block)

	return {
		kind,
		descriptor,
		window,
		blockName: block.name,
		position,
		openedAt: new Date().toISOString()
	}
}

export const transferWindowItem = async (
	bot: Bot,
	session: WindowSession,
	request: WindowTransferRequest
): Promise<WindowTransferResult> => {
	if (!session.window) {
		throw new Error('No active window session')
	}

	if (request.count <= 0) {
		throw new Error('Transfer count must be positive')
	}

	if (request.sourceZone === request.destZone) {
		throw new Error('Source and destination zones must differ')
	}

	const slots = Array.isArray(session.window?.slots) ? session.window.slots : []
	const zoneSlots = session.descriptor.resolveZones(slots.length)
	const sourceRange = toRange(zoneSlots[request.sourceZone] ?? [])
	const destRange = toRange(zoneSlots[request.destZone] ?? [])

	if (!sourceRange) {
		throw new Error(`Source zone ${request.sourceZone} is not available`)
	}

	if (!destRange) {
		throw new Error(`Destination zone ${request.destZone} is not available`)
	}

	const item = session.window.findItemRangeName(
		sourceRange.start,
		sourceRange.end,
		request.itemName,
		null,
		true
	)

	if (!item) {
		throw new Error(
			`Item ${request.itemName} was not found in ${request.sourceZone}`
		)
	}

	await (bot as any).transfer({
		window: session.window,
		itemType: item.type,
		metadata: item.metadata ?? null,
		sourceStart: sourceRange.start,
		sourceEnd: sourceRange.end,
		destStart: destRange.start,
		destEnd: destRange.end,
		count: request.count
	})

	return {
		sourceZone: request.sourceZone,
		destZone: request.destZone,
		itemName: request.itemName,
		count: request.count
	}
}

export const closeWindowSession = (bot: Bot, session: WindowSession): void => {
	if (!session.window) {
		return
	}

	if (typeof session.window.close === 'function') {
		session.window.close()
		return
	}

	bot.closeWindow(session.window)
}

export const closeWindowSessionSafely = (
	bot: Bot,
	session: WindowSession
): WindowCloseResult => {
	try {
		closeWindowSession(bot, session)
		return { ok: true }
	} catch (error) {
		const reason =
			error instanceof Error ? error.message : 'Unknown window close error'

		console.warn('[AI] failed to close temporary window session', reason)
		return { ok: false, reason }
	}
}

export const describeWindowSession = (
	session: WindowSession
): WindowSnapshot => {
	const slots = Array.isArray(session.window?.slots) ? session.window.slots : []
	const zoneSlots = session.descriptor.resolveZones(slots.length)

	return {
		kind: session.kind,
		blockName: session.blockName,
		position: session.position,
		zones: buildZoneSnapshots(slots, zoneSlots)
	}
}

export const describePlayerInventory = (bot: Bot): WindowSnapshot => {
	const slots = Array.isArray(bot.inventory?.slots) ? bot.inventory.slots : []
	const descriptor = getWindowDescriptor('player_inventory')
	const zoneSlots = descriptor.resolveZones(slots.length)

	return {
		kind: 'player_inventory',
		blockName: null,
		position: null,
		zones: buildZoneSnapshots(slots, zoneSlots)
	}
}
