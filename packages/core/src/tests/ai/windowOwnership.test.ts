import assert from 'node:assert/strict'
import test from 'node:test'

import {
	WindowRuntime,
	type WindowSession,
	getWindowDescriptor
} from '../../ai/runtime/window.js'

const position = { x: 1, y: 64, z: 1 }
const session = (): WindowSession => ({
	kind: 'generic_container',
	descriptor: getWindowDescriptor('generic_container'),
	window: { slots: [] },
	blockName: 'chest',
	position,
	openedAt: '2026-09-08T00:00:00Z'
})

test('failed temporary inspection close preserves the session and blocks a second window', async () => {
	const owned = session()
	let current: unknown = null
	let failClose = true
	const windows = new WindowRuntime({
		current: () => current,
		open: async () => {
			current = owned.window
			return owned
		},
		close: () => {
			if (failClose) throw new Error('close failed')
			current = null
		},
		transfer: async (_session, request) => request
	})
	await assert.rejects(windows.inspect(position), /close failed/)
	assert.equal(windows.getSnapshot().state, 'close_failed')
	await assert.rejects(windows.open(position), /close/i)
	failClose = false
	assert.equal(windows.close().ok, true)
	assert.equal(windows.getSnapshot().session, null)
})

test('cleanup of a superseded window cannot close the new window or copy old inventory', async () => {
	const owned = session()
	let current: unknown = null
	let inventory = 'new inventory'
	const windows = new WindowRuntime({
		current: () => current,
		open: async () => {
			current = owned.window
			return owned
		},
		close: () => {
			current = null
			inventory = 'old inventory'
		},
		transfer: async (_session, request) => request
	})
	await windows.open(position)
	const newer = { slots: [] }
	current = newer
	windows.close()
	assert.equal(current, newer)
	assert.equal(inventory, 'new inventory')
})

test(
	'cancelled opening settles in the background and cannot overlap a newer opening',
	{ timeout: 1000 },
	async () => {
		const owned = session()
		let current: unknown = null
		let resolveOpen!: (session: WindowSession) => void
		const opening = new Promise<WindowSession>(resolve => {
			resolveOpen = resolve
		})
		const windows = new WindowRuntime({
			current: () => current,
			open: () => opening,
			close: () => {
				current = null
			},
			transfer: async (_session, request) => request
		})
		const controller = new AbortController()
		const pending = windows.open(position, controller.signal)
		controller.abort()
		await assert.rejects(pending, /abort/i)
		await assert.rejects(windows.open(position), /pending|settling/i)
		current = owned.window
		resolveOpen(owned)
		await new Promise(resolve => setImmediate(resolve))
		assert.equal(current, null)
		assert.equal(windows.getSnapshot().session, null)
	}
)

test('a non-throwing close must still release the owned current window', async () => {
	const owned = session()
	let current: unknown = null
	const windows = new WindowRuntime({
		current: () => current,
		open: async () => {
			current = owned.window
			return owned
		},
		close: () => {},
		transfer: async (_, request) => request
	})
	await windows.open(position)
	assert.equal(windows.close().ok, false)
	assert.equal(windows.getSnapshot().state, 'close_failed')
	assert.equal(windows.getSnapshot().session, owned)
})

test('cancelled transfer holds the window slot until Mineflayer settles without blocking close', async () => {
	const owned = session()
	let current: unknown = null
	let finish!: () => void
	const pendingTransfer = new Promise<void>(resolve => {
		finish = resolve
	})
	const windows = new WindowRuntime({
		current: () => current,
		open: async () => {
			current = owned.window
			return owned
		},
		close: () => {
			current = null
		},
		transfer: async (_, request) => {
			await pendingTransfer
			return request
		}
	})
	await windows.open(position)
	const controller = new AbortController()
	const pending = windows.transfer(
		{
			sourceZone: 'container',
			destZone: 'hotbar',
			itemName: 'stone',
			count: 1
		},
		controller.signal
	)
	controller.abort()
	await assert.rejects(pending, /abort/i)
	assert.equal(windows.close().ok, false)
	assert.equal(current, null)
	await assert.rejects(windows.open(position), /settling/i)
	finish()
	await new Promise(resolve => setImmediate(resolve))
	await windows.open(position)
	assert.equal(windows.getSnapshot().state, 'open')
})

test('transfer cannot report success after its window was superseded', async () => {
	const owned = session()
	let current: unknown = null
	const windows = new WindowRuntime({
		current: () => current,
		open: async () => {
			current = owned.window
			return owned
		},
		close: () => {
			current = null
		},
		transfer: async (_, request) => {
			current = { slots: [] }
			return request
		}
	})
	await windows.open(position)
	await assert.rejects(
		windows.transfer({
			sourceZone: 'container',
			destZone: 'hotbar',
			itemName: 'stone',
			count: 1
		}),
		/no longer current/i
	)
})

test('opening deadline releases the caller but quarantines the unresolved operation', async t => {
	t.mock.timers.enable({ apis: ['setTimeout'] })
	const owned = session()
	let current: unknown = null
	let finish!: (value: WindowSession) => void
	const windows = new WindowRuntime({
		current: () => current,
		open: () =>
			new Promise(resolve => {
				finish = resolve
			}),
		close: () => {
			current = null
		},
		transfer: async (_, request) => request
	})
	const pending = windows.open(position)
	t.mock.timers.tick(15_000)
	await assert.rejects(pending, /timed out/i)
	assert.equal(windows.getSnapshot().busy, true)
	await assert.rejects(windows.open(position), /settling/)
	current = owned.window
	finish(owned)
	await new Promise(resolve => setImmediate(resolve))
	assert.equal(current, null)
	assert.equal(windows.getSnapshot().busy, false)
})
