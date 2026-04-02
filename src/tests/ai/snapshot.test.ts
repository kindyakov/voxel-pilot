import assert from 'node:assert/strict'
import test from 'node:test'

import { buildSnapshot } from '../../ai/snapshot.js'

const createVec3 = (x: number, y: number, z: number) => ({
	x,
	y,
	z
})

const createZoneMap = () => ({
	container: [],
	input: [0],
	fuel: [1],
	output: [2],
	player_inventory: [],
	hotbar: []
})

test('buildSnapshot renders runtime-only sections and active window summary', () => {
	const bot = {
		health: 18,
		food: 7,
		oxygenLevel: 20,
		entity: {
			position: createVec3(10, 64, -5)
		},
		game: {
			dimension: 'overworld'
		}
	} as any

	const activeWindowSession = {
		kind: 'furnace_family',
		descriptor: {
			kind: 'furnace_family',
			label: 'furnace',
			openWindow: async () => null,
			resolveZones: createZoneMap
		},
		window: {
			slots: []
		},
		blockName: 'furnace',
		position: createVec3(12, 64, -4),
		openedAt: '2026-01-01T00:00:00.000Z'
	} as any

	const snapshot = buildSnapshot({
		bot,
		currentGoal: 'Smelt iron',
		subGoal: 'Inspect furnace',
		lastAction: 'inspect_window',
		lastResult: 'FAILED',
		lastReason: 'Window is too far away (5.2m)',
		errorHistory: ['Window is too far away (5.2m)', 'No coal'],
		activeWindowSession,
		activeWindowSessionState: 'open'
	})

	assert.match(snapshot, /STATUS/)
	assert.match(snapshot, /ACTIVE_WINDOW_SESSION/)
	assert.match(snapshot, /GOAL_CONTEXT/)
	assert.match(snapshot, /FEEDBACK_ERRORS/)

	assert.match(snapshot, /health: 18\/20/)
	assert.match(snapshot, /food: 7\/20/)
	assert.match(snapshot, /oxygen: 20\/20/)
	assert.match(snapshot, /position: 10,64,-5/)
	assert.match(snapshot, /dimension: overworld/)

	assert.match(snapshot, /is_open: true/)
	assert.match(snapshot, /window_kind: furnace_family/)
	assert.match(snapshot, /block_name: furnace/)
	assert.match(snapshot, /position: 12,64,-4/)
	assert.match(snapshot, /close_failed: false/)

	assert.match(snapshot, /current_goal: Smelt iron/)
	assert.match(snapshot, /sub_goal: Inspect furnace/)
	assert.match(snapshot, /last_action: inspect_window/)
	assert.match(snapshot, /last_result: FAILED/)
	assert.match(snapshot, /last_reason: Window is too far away \(5.2m\)/)
	assert.match(snapshot, /error_history: Window is too far away \(5.2m\) \| No coal/)

	assert.equal(snapshot.includes('INVENTORY_EQUIPMENT'), false)
	assert.equal(snapshot.includes('ENVIRONMENT'), false)
	assert.equal(snapshot.includes('time:'), false)
	assert.equal(snapshot.includes('biome:'), false)
	assert.equal(snapshot.includes('action_result:'), false)
})

test('buildSnapshot caps error history and reports close_failed state without session', () => {
	const bot = {
		health: 20,
		food: 20,
		oxygenLevel: 20,
		entity: {
			position: createVec3(0, 64, 0)
		}
	} as any

	const snapshot = buildSnapshot({
		bot,
		currentGoal: 'Survive',
		subGoal: null,
		lastAction: null,
		lastResult: null,
		lastReason: null,
		errorHistory: ['a', 'b', 'c', 'd'],
		activeWindowSession: null,
		activeWindowSessionState: 'close_failed'
	})

	assert.match(snapshot, /is_open: false/)
	assert.match(snapshot, /window_kind: -/)
	assert.match(snapshot, /block_name: -/)
	assert.match(snapshot, /position: -/)
	assert.match(snapshot, /close_failed: true/)
	assert.match(snapshot, /error_history: a \| b \| c/)
	assert.equal(snapshot.includes('error_history: a | b | c | d'), false)
})
