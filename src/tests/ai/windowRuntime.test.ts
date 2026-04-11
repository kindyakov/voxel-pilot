import assert from 'node:assert/strict'
import test from 'node:test'

import type { WindowSession } from '../../ai/runtime/window.js'
import {
	describePlayerInventory,
	inferWindowKindFromBlockName
} from '../../ai/runtime/window.js'
import { executeInlineToolCall } from '../../ai/tools.js'

const createVec3 = (x: number, y: number, z: number) => ({
	x,
	y,
	z,
	distanceTo(other: { x: number; y: number; z: number }) {
		const dx = x - other.x
		const dy = y - other.y
		const dz = z - other.z
		return Math.sqrt(dx * dx + dy * dy + dz * dz)
	}
})

const createActiveWindowSession = (position: {
	x: number
	y: number
	z: number
}): WindowSession =>
	({
		kind: 'furnace_family',
		descriptor: {
			kind: 'furnace_family',
			label: 'furnace',
			openWindow: async () => ({ slots: [] }),
			resolveZones: () => ({
				container: [],
				input: [0],
				fuel: [1],
				output: [2],
				player_inventory: [],
				hotbar: []
			})
		},
		window: {
			slots: [
				{ name: 'iron_ore', count: 3 },
				{ name: 'coal', count: 1 },
				{ name: 'iron_ingot', count: 2 }
			]
		},
		blockName: 'furnace',
		position,
		openedAt: '2026-01-01T00:00:00.000Z'
	}) as WindowSession

test('inferWindowKindFromBlockName classifies furnace-family and crafting-table windows', () => {
	assert.equal(inferWindowKindFromBlockName('furnace'), 'furnace_family')
	assert.equal(inferWindowKindFromBlockName('blast_furnace'), 'furnace_family')
	assert.equal(inferWindowKindFromBlockName('crafting_table'), 'crafting_table')
	assert.equal(inferWindowKindFromBlockName('barrel'), 'generic_container')
	assert.equal(inferWindowKindFromBlockName('stonecutter'), null)
})

test('describePlayerInventory exposes semantic zones for hotbar and inventory', () => {
	const bot = {
		inventory: {
			slots: Array.from({ length: 46 }, () => null)
		}
	} as any

	bot.inventory.slots[10] = {
		name: 'oak_planks',
		count: 32
	}
	bot.inventory.slots[36] = {
		name: 'iron_pickaxe',
		count: 1
	}

	const snapshot = describePlayerInventory(bot)

	const inventoryZone = snapshot.zones.find(
		zone => zone.zone === 'player_inventory'
	)
	const hotbarZone = snapshot.zones.find(zone => zone.zone === 'hotbar')

	assert.equal(snapshot.kind, 'player_inventory')
	assert.ok(inventoryZone)
	assert.ok(hotbarZone)
	assert.equal('slots' in inventoryZone, false)
	assert.equal(
		inventoryZone?.items.some(item => item.name === 'oak_planks'),
		true
	)
	assert.equal('slot' in (inventoryZone?.items[0] ?? {}), false)
	assert.equal(
		hotbarZone?.items.some(item => item.name === 'iron_pickaxe'),
		true
	)
})

test('inspect_window opens, snapshots, and closes a furnace-family window', async () => {
	let openCalls = 0
	let closeCalls = 0
	const window = {
		slots: [
			{ name: 'iron_ore', count: 3 },
			{ name: 'coal', count: 1 },
			{ name: 'iron_ingot', count: 2 }
		],
		close: () => {
			closeCalls += 1
		}
	}

	const bot = {
		memory: {
			saveEntry: () => null,
			readEntries: () => [],
			updateEntryData: () => null,
			deleteEntry: () => false
		},
		entity: { position: createVec3(0, 64, 0) },
		blockAt: (position: { x: number; y: number; z: number }) =>
			position.x === 1 && position.y === 64 && position.z === 1
				? {
						name: 'furnace',
						position: createVec3(1, 64, 1)
					}
				: null,
		openFurnace: async () => {
			openCalls += 1
			return window
		},
		closeWindow: () => {},
		inventory: {
			slots: Array.from({ length: 46 }, () => null),
			items: () => []
		}
	} as any

	const result = await executeInlineToolCall(
		'inspect_window',
		{
			position: { x: 1, y: 64, z: 1 }
		},
		{
			bot
		}
	)

	assert.equal(result.ok, true)
	assert.equal(openCalls, 1)
	assert.equal(closeCalls, 1)

	const output = result.output as any
	assert.equal(output.kind, 'furnace_family')
	assert.equal(output.blockName, 'furnace')
	assert.equal(output.close.ok, true)
	assert.equal('slots' in output.window.zones[0], false)
	assert.equal('slot' in (output.window.zones[0].items[0] ?? {}), false)
	assert.equal(
		output.window.zones.find((zone: { zone: string }) => zone.zone === 'input')
			?.items[0]?.name,
		'iron_ore'
	)
	assert.equal(
		output.window.zones.find((zone: { zone: string }) => zone.zone === 'fuel')
			?.items[0]?.name,
		'coal'
	)
	assert.equal(
		output.window.zones.find((zone: { zone: string }) => zone.zone === 'output')
			?.items[0]?.name,
		'iron_ingot'
	)
})

test('inspect_window fails when temporary close fails', async () => {
	let openCalls = 0
	let closeCalls = 0
	const window = {
		slots: [{ name: 'iron_ore', count: 3 }],
		close: () => {
			closeCalls += 1
			throw new Error('close failed')
		}
	}

	const bot = {
		memory: {
			saveEntry: () => null,
			readEntries: () => [],
			updateEntryData: () => null,
			deleteEntry: () => false
		},
		entity: { position: createVec3(0, 64, 0) },
		blockAt: (position: { x: number; y: number; z: number }) =>
			position.x === 1 && position.y === 64 && position.z === 1
				? {
						name: 'furnace',
						position: createVec3(1, 64, 1)
					}
				: null,
		openFurnace: async () => {
			openCalls += 1
			return window
		},
		closeWindow: () => {},
		inventory: {
			slots: Array.from({ length: 46 }, () => null),
			items: () => []
		}
	} as any

	const result = await executeInlineToolCall(
		'inspect_window',
		{
			position: { x: 1, y: 64, z: 1 }
		},
		{
			bot
		}
	)

	assert.equal(result.ok, false)
	assert.equal(openCalls, 1)
	assert.equal(closeCalls, 1)
	assert.match(
		String((result.output as any).reason),
		/runtime window state is untrusted/i
	)
	assert.equal((result.output as any).close.ok, false)
	assert.match(String((result.output as any).close.reason), /close failed/)
	assert.equal('window' in (result.output as any), false)
})

test('inspect_window rejects stale close_failed sessions', async () => {
	let openCalls = 0
	const activeSession = createActiveWindowSession({ x: 1, y: 64, z: 1 })

	const bot = {
		memory: {
			saveEntry: () => null,
			readEntries: () => [],
			updateEntryData: () => null,
			deleteEntry: () => false
		},
		entity: { position: createVec3(0, 64, 0) },
		blockAt: () => null,
		openFurnace: async () => {
			openCalls += 1
			return { slots: [], close: () => {} }
		},
		closeWindow: () => {},
		inventory: {
			slots: Array.from({ length: 46 }, () => null),
			items: () => []
		}
	} as any

	const result = await executeInlineToolCall(
		'inspect_window',
		{
			position: { x: 1, y: 64, z: 1 }
		},
		{
			bot,
			activeWindowSession: activeSession,
			activeWindowSessionState: 'close_failed'
		}
	)

	assert.equal(result.ok, false)
	assert.match(
		String((result.output as any).reason),
		/stale \(previous close failed\)/i
	)
	assert.equal(openCalls, 0)
})

test('inspect_window rejects different-position inspect when another session is active', async () => {
	let openCalls = 0
	const activeSession = createActiveWindowSession({ x: 1, y: 64, z: 1 })

	const bot = {
		memory: {
			saveEntry: () => null,
			readEntries: () => [],
			updateEntryData: () => null,
			deleteEntry: () => false
		},
		entity: { position: createVec3(0, 64, 0) },
		blockAt: () => null,
		openFurnace: async () => {
			openCalls += 1
			return { slots: [], close: () => {} }
		},
		closeWindow: () => {},
		inventory: {
			slots: Array.from({ length: 46 }, () => null),
			items: () => []
		}
	} as any

	const result = await executeInlineToolCall(
		'inspect_window',
		{
			position: { x: 2, y: 64, z: 2 }
		},
		{
			bot,
			activeWindowSession: activeSession,
			activeWindowSessionState: 'open'
		}
	)

	assert.equal(result.ok, false)
	assert.match(String((result.output as any).reason), /different position/i)
	assert.equal(openCalls, 0)
})

test('inspect_window reuses same-position active sessions', async () => {
	let openCalls = 0
	const activeSession = createActiveWindowSession({ x: 1, y: 64, z: 1 })

	const bot = {
		memory: {
			saveEntry: () => null,
			readEntries: () => [],
			updateEntryData: () => null,
			deleteEntry: () => false
		},
		entity: { position: createVec3(0, 64, 0) },
		blockAt: () => null,
		openFurnace: async () => {
			openCalls += 1
			return { slots: [], close: () => {} }
		},
		closeWindow: () => {},
		inventory: {
			slots: Array.from({ length: 46 }, () => null),
			items: () => []
		}
	} as any

	const result = await executeInlineToolCall(
		'inspect_window',
		{
			position: { x: 1, y: 64, z: 1 }
		},
		{
			bot,
			activeWindowSession: activeSession,
			activeWindowSessionState: 'open'
		}
	)

	assert.equal(result.ok, true)
	assert.equal(openCalls, 0)
	assert.equal((result.output as any).reusedActiveSession, true)
	assert.equal((result.output as any).kind, 'furnace_family')
	assert.equal((result.output as any).blockName, 'furnace')
	assert.equal((result.output as any).closeFailed, false)
	assert.equal((result.output as any).window.kind, 'furnace_family')
	assert.equal(
		(result.output as any).window.zones.find(
			(zone: { zone: string }) => zone.zone === 'input'
		)?.items[0]?.name,
		'iron_ore'
	)
})

test('inspect_inventory returns the inventory snapshot without opening a window', async () => {
	let openCalls = 0
	const bot = {
		memory: {
			saveEntry: () => null,
			readEntries: () => [],
			updateEntryData: () => null,
			deleteEntry: () => false
		},
		entity: { position: createVec3(0, 64, 0) },
		inventory: {
			slots: Array.from({ length: 46 }, () => null),
			items: () => []
		},
		openFurnace: async () => {
			openCalls += 1
			return { slots: [], close: () => {} }
		},
		closeWindow: () => {}
	} as any

	const result = await executeInlineToolCall('inspect_inventory', {}, { bot })

	assert.equal(result.ok, true)
	assert.equal(openCalls, 0)
	assert.equal((result.output as any).inventory.kind, 'player_inventory')
})

test('inspect_window rejects unsupported workstation blocks explicitly', async () => {
	let openCalls = 0
	const bot = {
		memory: {
			saveEntry: () => null,
			readEntries: () => [],
			updateEntryData: () => null,
			deleteEntry: () => false
		},
		entity: { position: createVec3(0, 64, 0) },
		blockAt: (position: { x: number; y: number; z: number }) =>
			position.x === 2 && position.y === 64 && position.z === 2
				? {
						name: 'stonecutter',
						position: createVec3(2, 64, 2)
					}
				: null,
		openContainer: async () => {
			openCalls += 1
			return { slots: [], close: () => {} }
		},
		inventory: {
			slots: Array.from({ length: 46 }, () => null),
			items: () => []
		},
		closeWindow: () => {}
	} as any

	const result = await executeInlineToolCall(
		'inspect_window',
		{
			position: { x: 2, y: 64, z: 2 }
		},
		{
			bot
		}
	)

	assert.equal(result.ok, false)
	assert.match(
		String((result.output as any).reason),
		/Unsupported window block/
	)
	assert.equal(openCalls, 0)
})

test('tools facade re-exports dedicated tool ownership modules', async () => {
	const [
		contracts,
		promptModule,
		catalogModule,
		namesModule,
		summaryModule,
		sharedModule,
		inlineExecutorModule,
		facade
	] = await Promise.all([
		import('../../ai/contracts/execution.js'),
		import('../../ai/tools/prompt.js'),
		import('../../ai/tools/catalog.js'),
		import('../../ai/tools/names.js'),
		import('../../ai/tools/summary.js'),
		import('../../ai/tools/shared.js'),
		import('../../ai/tools/inlineExecutor.js'),
		import('../../ai/tools.js')
	])

	assert.equal('PendingExecution' in contracts, false)
	assert.equal(typeof promptModule.AGENT_SYSTEM_PROMPT, 'string')
	assert.equal(catalogModule.AGENT_TOOLS, facade.AGENT_TOOLS)
	assert.equal(namesModule.isExecutionToolName, facade.isExecutionToolName)
	assert.equal(summaryModule.summarizeExecution, facade.summarizeExecution)
	assert.equal(sharedModule.toBlocksScope({}), 'all')
	assert.equal(
		inlineExecutorModule.executeInlineToolCall,
		facade.executeInlineToolCall
	)
})
