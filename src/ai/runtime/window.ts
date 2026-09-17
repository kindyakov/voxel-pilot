import { Vec3 } from 'vec3'

import type { Bot } from '@/types/index.js'

import type { MemoryPosition } from '@/core/memory/types.js'

import type { WindowZone } from '../tools/executionDefinitions.js'

export type WindowKind =
	| 'player_inventory'
	| 'generic_container'
	| 'furnace_family'
	| 'crafting_table'

export type { WindowZone } from '../tools/executionDefinitions.js'

interface WindowItemSnapshot {
	name: string
	count: number
	maxDurability?: number | null
	durabilityUsed?: number | null
}

interface WindowZoneSnapshot {
	zone: WindowZone
	items: WindowItemSnapshot[]
}

interface WindowSnapshot {
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

interface WindowCloseResult {
	ok: boolean
	reason?: string
}

interface WindowOperations {
	current(): unknown
	open(position: MemoryPosition): Promise<WindowSession>
	close(session: WindowSession): void
	transfer(
		session: WindowSession,
		request: WindowTransferRequest
	): Promise<WindowTransferResult>
}

/** Owns active and temporary windows; callers never close raw session handles. */
export class WindowRuntime {
	private session: WindowSession | null = null
	private state: 'open' | 'close_failed' | null = null
	private pending: AbortController | null = null

	constructor(private readonly operations: WindowOperations) {}

	getSnapshot() {
		return {
			session: this.session,
			state: this.state,
			busy: this.pending !== null
		}
	}

	private async run<T>(
		work: (signal: AbortSignal) => Promise<T>,
		signal?: AbortSignal
	): Promise<T> {
		signal?.throwIfAborted()
		if (this.pending)
			throw new Error('Previous window operation is still settling')
		const controller = new AbortController()
		this.pending = controller
		const cancel = () => controller.abort(signal?.reason)
		signal?.addEventListener('abort', cancel, { once: true })
		const timer = setTimeout(
			() => controller.abort(new Error('Window operation timed out')),
			15_000
		)
		let rejectAbort: () => void = () => {}
		const cancelled = new Promise<never>((_, reject) => {
			rejectAbort = () => reject(controller.signal.reason)
			controller.signal.addEventListener('abort', rejectAbort, { once: true })
		})
		// Keep the slot until the underlying Mineflayer operation settles, even after cancellation.
		const operation = work(controller.signal).finally(() => {
			if (this.pending === controller) this.pending = null
		})
		try {
			return await Promise.race([operation, cancelled])
		} finally {
			clearTimeout(timer)
			signal?.removeEventListener('abort', cancel)
			controller.signal.removeEventListener('abort', rejectAbort)
		}
	}

	private async acquire(
		position: MemoryPosition,
		signal: AbortSignal
	): Promise<WindowSession> {
		signal.throwIfAborted()
		if (this.session)
			throw new Error('Close the active window before opening another')
		if (this.operations.current())
			throw new Error('An unowned window is already open')
		const session = await this.operations.open(position)
		if (this.operations.current() !== session.window)
			throw new Error('Window was superseded before opening completed')
		this.session = session
		this.state = 'open'
		if (signal.aborted) {
			this.closeOwned()
			signal.throwIfAborted()
		}
		return session
	}

	open(position: MemoryPosition, signal?: AbortSignal): Promise<WindowSession> {
		return this.run(active => this.acquire(position, active), signal)
	}

	private closeOwned(): WindowCloseResult {
		if (!this.session) return { ok: true }
		try {
			// Mineflayer close mutates currentWindow and inventory; never call it for an old handle.
			if (this.operations.current() === this.session.window) {
				this.operations.close(this.session)
				if (this.operations.current() === this.session.window)
					throw new Error('Window close is unconfirmed')
			}
			this.session = null
			this.state = null
			return { ok: true }
		} catch (error) {
			this.state = 'close_failed'
			return {
				ok: false,
				reason: error instanceof Error ? error.message : String(error)
			}
		}
	}

	/** Immediate resource cancellation; never waits before survival can take over. */
	close(): WindowCloseResult {
		this.pending?.abort()
		const result = this.closeOwned()
		if (!result.ok) return result
		return this.pending
			? { ok: false, reason: 'Window operation is still settling' }
			: result
	}

	inspect(position?: MemoryPosition | null, signal?: AbortSignal) {
		return this.run(async active => {
			if (this.state === 'close_failed')
				throw new Error('Active window close failed; retry close_window')
			if (this.session) {
				if (this.operations.current() !== this.session.window)
					throw new Error('Active window is no longer current; close it first')
				if (
					position &&
					(position.x !== this.session.position?.x ||
						position.y !== this.session.position?.y ||
						position.z !== this.session.position?.z)
				) {
					throw new Error(
						'Active window is at a different position; close it first'
					)
				}
				return {
					reusedActiveSession: true,
					kind: this.session.kind,
					blockName: this.session.blockName,
					window: describeWindowSession(this.session),
					closeFailed: false
				}
			}
			if (!position)
				throw new Error(
					'No active window session. Provide position to inspect nearby window block.'
				)
			const session = await this.acquire(position, active)
			try {
				active.throwIfAborted()
				return {
					reusedActiveSession: false,
					kind: session.kind,
					blockName: session.blockName,
					window: describeWindowSession(session),
					close: { ok: true }
				}
			} finally {
				const result = this.closeOwned()
				if (!result.ok)
					throw new Error(`Failed to close temporary window: ${result.reason}`)
			}
		}, signal)
	}

	transfer(
		request: WindowTransferRequest,
		signal?: AbortSignal
	): Promise<WindowTransferResult> {
		return this.run(async active => {
			if (!this.session) throw new Error('No active window session')
			if (this.state === 'close_failed')
				throw new Error('Active window close is unconfirmed')
			if (this.operations.current() !== this.session.window)
				throw new Error('Active window is no longer current')
			const session = this.session
			const result = await this.operations.transfer(session, request)
			active.throwIfAborted()
			if (this.operations.current() !== session.window)
				throw new Error('Active window is no longer current')
			return result
		}, signal)
	}
}

const runtimes = new WeakMap<Bot, WindowRuntime>()

/** There is exactly one window owner per live bot, shared by HSM and inline tools. */
export const getWindowRuntime = (bot: Bot): WindowRuntime => {
	const existing = runtimes.get(bot)
	if (existing) return existing
	const runtime = new WindowRuntime({
		current: () => bot.currentWindow,
		open: async position => {
			const block = bot.blockAt(new Vec3(position.x, position.y, position.z))
			if (!block) throw new Error('Window block not found')
			const distance = bot.entity.position.distanceTo(block.position)
			if (distance > 4)
				throw new Error(`Window is too far away (${distance.toFixed(1)}m)`)
			return openWindowSession(bot, block, position)
		},
		close: session => closeWindowSession(bot, session),
		transfer: (session, request) => transferWindowItem(bot, session, request)
	})

	runtimes.set(bot, runtime)
	return runtime
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

const openWindowSession = async (
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

const transferWindowItem = async (
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

const closeWindowSession = (bot: Bot, session: WindowSession): void => {
	if (!session.window) {
		return
	}

	if (typeof session.window.close === 'function') {
		session.window.close()
		return
	}

	bot.closeWindow(session.window)
}

const describeWindowSession = (session: WindowSession): WindowSnapshot => {
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
