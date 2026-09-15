import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import test from 'node:test'
import { setImmediate as flush } from 'node:timers/promises'

import { HandoffBot, ItemFactory, registry } from './fixtures/handoffBot'

const require = createRequire(import.meta.url)

const fixture = (t: test.TestContext) => {
	t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] })
	const bot = new HandoffBot()
	const clicks: number[] = []
	let afterClick = () => {}
	Object.assign(bot, {
		supportFeature: (feature: string) => registry.supportFeature(feature)
	})
	Object.assign(bot._client, {
		write: (name: string, packet: { mode?: number }) => {
			if (name === 'window_click') {
				clicks.push(packet.mode ?? -1)
				afterClick()
			}
		}
	})
	require('mineflayer/lib/plugins/inventory')(bot, { hideErrors: true })
	require('mineflayer/lib/plugins/simple_inventory')(bot)
	const native = bot.asBot()
	native.quickBarSlot = 0
	const put = (slot: number, name: string) => {
		const item = new ItemFactory(registry.itemsByName[name].id, 1)
		item.slot = slot
		native.inventory.slots[slot] = item
		return item
	}
	put(36, 'iron_sword')
	put(37, 'stone')
	const bread = put(9, 'bread')
	return {
		native,
		clicks,
		put,
		bread,
		onClick: (callback: () => void) => {
			afterClick = callback
		}
	}
}

for (const destination of ['head', 'off-hand'] as const) {
	for (const cancelAfter of [0, 1, 2, 3, null]) {
		test(`native ${destination} equip preserves inventory and the active hand when canceled after ${cancelAfter ?? 'no'} swaps`, async t => {
			const { native, clicks, put, onClick, bread } = fixture(t)
			const targetSlot = destination === 'head' ? 5 : 45
			const item = put(10, destination === 'head' ? 'iron_helmet' : 'shield')
			put(
				targetSlot,
				destination === 'head' ? 'leather_helmet' : 'totem_of_undying'
			)
			const contents = () =>
				native.inventory.slots.flatMap(item => (item ? [item.name] : [])).sort()
			const before = contents()
			const controller = new AbortController()
			onClick(() => {
				if (clicks.length === cancelAfter)
					controller.abort(new Error('Equip canceled'))
			})
			if (cancelAfter === 0) controller.abort(new Error('Equip canceled'))
			const equip = native.equip(item, destination, {
				signal: controller.signal
			})
			if (cancelAfter === null) await equip
			else await assert.rejects(equip, /canceled/)
			assert.equal(native.inventory.selectedItem, null)
			assert.deepEqual(contents(), before)
			assert.equal(native.heldItem?.name, 'iron_sword')
			assert.equal(clicks.length, cancelAfter ?? 3)
			assert.ok(clicks.every(mode => mode === 2))
			if (cancelAfter === null) {
				assert.equal(native.inventory.slots[targetSlot]?.name, item.name)
				assert.equal(native.inventory.slots[37]?.name, 'stone')
			}
			onClick(() => {})
			await native.equip(bread, 'hand')
			assert.equal(native.heldItem?.name, 'bread')
			assert.equal(native.inventory.selectedItem, null)
		})
	}
}

test('a delayed native swap refuses a cursor acquired by another operation', async t => {
	const { native, bread, clicks, put } = fixture(t)
	Object.assign(native, { lastDigTime: Date.now() })
	const equip = native.equip(bread, 'hand')
	const rejection = assert.rejects(equip, /carrying an item/)
	await flush()
	const cursor = put(11, 'diamond')
	native.inventory.selectedItem = cursor
	t.mock.timers.tick(1000)
	await rejection
	assert.equal(clicks.length, 0)
	assert.equal(native.inventory.slots[9]?.name, 'bread')
	assert.equal(native.inventory.selectedItem, cursor)
})

test('a replacement weapon selected by heldItemChanged is not overwritten by canceled equip', async t => {
	const { native, bread, put } = fixture(t)
	put(38, 'bow')
	const controller = new AbortController()
	native.once('heldItemChanged', () => {
		controller.abort(new Error('Equip canceled by replacement'))
		native.setQuickBarSlot(2)
	})
	await assert.rejects(
		native.equip(bread, 'hand', { signal: controller.signal }),
		/canceled/
	)
	assert.equal(native.quickBarSlot, 2)
	assert.equal(native.heldItem?.name, 'bow')
	assert.equal(native.inventory.selectedItem, null)
})
