import assert from 'node:assert/strict'
import test from 'node:test'

import { executeInlineToolCall } from '../../ai/tools.js'
import {
	describePlayerInventory,
	inferWindowKindFromBlockName
} from '../../ai/runtime/window.js'

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

	const inventoryZone = snapshot.zones.find(zone => zone.zone === 'player_inventory')
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

	const result = await executeInlineToolCall('inspect_window', {
		position: { x: 1, y: 64, z: 1 }
	}, {
		bot
	})

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

test('inspect_window preserves the snapshot when temporary close fails', async () => {
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

	const result = await executeInlineToolCall('inspect_window', {
		position: { x: 1, y: 64, z: 1 }
	}, {
		bot
	})

	assert.equal(result.ok, true)
	assert.equal(openCalls, 1)
	assert.equal(closeCalls, 1)

	const output = result.output as any
	assert.equal(output.close.ok, false)
	assert.match(String(output.close.reason), /close failed/)
	assert.equal(output.window.kind, 'furnace_family')
	assert.equal(
		output.window.zones.find((zone: { zone: string }) => zone.zone === 'input')
			?.items[0]?.name,
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

	const result = await executeInlineToolCall('inspect_window', {
		position: { x: 2, y: 64, z: 2 }
	}, {
		bot
	})

	assert.equal(result.ok, false)
	assert.match(String(result.output.reason), /Unsupported window block/)
	assert.equal(openCalls, 0)
})
