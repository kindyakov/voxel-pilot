import assert from 'node:assert/strict'
import test from 'node:test'

import blockLoader from 'prismarine-block'
import itemLoader from 'prismarine-item'
import registryLoader from 'prismarine-registry'
import { Vec3 } from 'vec3'

import { resolveMiningResource } from '@/hsm/tasks/miningResource.js'
import {
	createMiningTask,
	refreshMiningQueue,
	sampleMiningInventory
} from '@/hsm/tasks/task.js'

import { equipMiningTool } from '@/utils/minecraft/miningTool.js'

const registry = registryLoader('1.20.4')
const Block = blockLoader('1.20.4')
const Item = itemLoader('1.20.4')
const block = (name: string, x = 1) => {
	const result = Block.fromStateId(registry.blocksByName[name]!.defaultState, 0)
	result.position = new Vec3(x, 64, 0)
	return result
}

test('coal uses both ores; exact ore output requires Silk Touch and preserves variant', () => {
	const coal = resolveMiningResource({ registry }, 'coal_ore', 'coal')
	assert.deepEqual(coal.blockNames, ['coal_ore', 'deepslate_coal_ore'])
	assert.equal(coal.silkTouch, 'forbidden')
	const ore = resolveMiningResource(
		{ registry },
		'deepslate_coal_ore',
		'deepslate_coal_ore'
	)
	assert.deepEqual(ore.blockNames, ['deepslate_coal_ore'])
	assert.equal(ore.silkTouch, 'required')
	assert.throws(() =>
		resolveMiningResource({ registry }, 'coal_ore', 'diamond')
	)
})

test('tool selection respects harvest level and exact Silk Touch requirement', async () => {
	const plain = new Item(registry.itemsByName.iron_pickaxe!.id, 1)
	const silk = new Item(registry.itemsByName.diamond_pickaxe!.id, 1)
	silk.enchants = [{ name: 'silk_touch', lvl: 1 }]
	let equipped: unknown
	const bot = {
		registry,
		inventory: { items: () => [silk, plain] },
		heldItem: silk,
		equip: async (item: unknown) => {
			equipped = item
		},
		unequip: async () => {
			equipped = null
		}
	}
	await equipMiningTool(
		bot,
		block('coal_ore'),
		resolveMiningResource({ registry }, 'coal_ore', 'coal')
	)
	assert.equal(equipped, plain)
	bot.heldItem = plain
	await equipMiningTool(
		bot,
		block('coal_ore'),
		resolveMiningResource({ registry }, 'coal_ore', 'coal_ore')
	)
	assert.equal(equipped, silk)
	bot.inventory.items = () => [plain]
	await assert.rejects(
		equipMiningTool(
			bot,
			block('coal_ore'),
			resolveMiningResource({ registry }, 'coal_ore', 'coal_ore')
		),
		/No harvest tool/
	)
})

test('queue discards vanished and unknown targets but keeps the next refreshed block', () => {
	const targets = [block('sand', 1), block('sand', 2), block('sand', 3)]
	const fresh = block('sand', 3)
	const task = { ...createMiningTask('sand', 10), targetBlocks: targets }
	const result = refreshMiningQueue(task, target =>
		target.position.x === 1
			? block('air')
			: target.position.x === 2
				? null
				: fresh
	)
	assert.deepEqual(result.targetBlocks, [fresh])
	assert.equal(result.targetBlocks[0], fresh)
	assert.deepEqual(result.blacklist, [])
	assert.equal(result.collected, 0)
	assert.equal(result.totalSearches, 0)
})

test('net inventory growth excludes initial stock and cannot double count dropped items', () => {
	let task = sampleMiningInventory(createMiningTask('coal_ore', 10), 20)
	task = sampleMiningInventory(task, 25)
	assert.equal(task.collected, 5)
	task = sampleMiningInventory(task, 20)
	assert.equal(task.collected, 0)
	task = sampleMiningInventory(task, 25)
	assert.equal(task.collected, 5)
	task = sampleMiningInventory(task, 30)
	assert.equal(task.collected, 10)
})

test('resumed segment preserves progress and ignores inventory changes during pause', () => {
	const task = { ...createMiningTask('coal_ore', 10), collected: 6 }
	const resumed = sampleMiningInventory(task, 0)
	assert.equal(sampleMiningInventory(resumed, 4).collected, 10)
})

test('Silk Touch selection decodes actual 1.20.6 network item components', async () => {
	const registry = registryLoader('1.20.6')
	const Item = itemLoader('1.20.6')
	const Block = blockLoader('1.20.6')
	const silk = Item.fromNotch({
		itemCount: 1,
		itemId: registry.itemsByName.diamond_pickaxe!.id,
		components: [
			{
				type: 'enchantments',
				data: {
					enchantments: [
						{ id: registry.enchantmentsByName.silk_touch!.id, level: 1 }
					],
					showTooltip: true
				}
			}
		],
		removeComponents: []
	})
	assert.ok(silk)
	const plain = new Item(registry.itemsByName.iron_pickaxe!.id, 1)
	const ore = Block.fromStateId(registry.blocksByName.coal_ore!.defaultState, 0)
	let equipped: unknown
	const bot = {
		registry,
		inventory: { items: () => [silk, plain] },
		heldItem: plain,
		equip: async (item: unknown) => {
			equipped = item
		},
		unequip: async () => {
			equipped = null
		}
	}
	await equipMiningTool(
		bot,
		ore,
		resolveMiningResource({ registry }, 'coal_ore', 'coal_ore')
	)
	assert.equal(equipped, silk)
	bot.heldItem = silk
	await equipMiningTool(
		bot,
		ore,
		resolveMiningResource({ registry }, 'coal_ore', 'coal')
	)
	assert.equal(equipped, plain)
})
