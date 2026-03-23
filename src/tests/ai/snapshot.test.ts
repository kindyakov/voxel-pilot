import assert from 'node:assert/strict'
import test from 'node:test'

import { buildSnapshot } from '../../ai/snapshot.js'

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

test('buildSnapshot renders compact world, inventory, equipment, goal, and feedback sections', () => {
	const bot = {
		health: 18,
		food: 7,
		oxygenLevel: 20,
		entity: {
			position: createVec3(10, 64, -5)
		},
		game: {
			dimension: 'overworld'
		},
		time: {
			timeOfDay: 1000,
			isDay: true
		},
		inventory: {
			slots: Array.from({ length: 46 }, () => null),
			items: () => [
				{
					name: 'iron_pickaxe',
					count: 1,
					maxDurability: 100,
					durabilityUsed: 60
				},
				{
					name: 'oak_log',
					count: 14
				}
			]
		},
		getEquipmentDestSlot(destination: string) {
			const mapping: Record<string, number> = {
				hand: 36,
				'off-hand': 45,
				head: 5,
				torso: 6,
				legs: 7,
				feet: 8
			}
			return mapping[destination]!
		},
		blockAt(position: { x: number; y: number; z: number }) {
			const key = `${position.x},${position.y},${position.z}`
			const blocks: Record<string, any> = {
				'10,64,-5': {
					name: 'grass_block',
					position: createVec3(10, 64, -5),
					biome: {
						name: 'plains'
					}
				},
				'12,64,-4': {
					name: 'crafting_table',
					position: createVec3(12, 64, -4),
					biome: {
						name: 'plains'
					}
				},
				'14,64,-3': {
					name: 'oak_log',
					position: createVec3(14, 64, -3),
					biome: {
						name: 'plains'
					}
				}
			}
			return blocks[key] ?? null
		},
		findBlocks({
			matching
		}: {
			matching: (block: { name: string }) => boolean
		}) {
			return [createVec3(12, 64, -4), createVec3(14, 64, -3)].filter(
				position => {
					const block = this.blockAt(position)
					return block ? matching(block) : false
				}
			)
		},
		entities: {
			1: {
				type: 'hostile',
				name: 'zombie',
				position: createVec3(15, 64, -5)
			},
			2: {
				type: 'mob',
				name: 'pig',
				position: createVec3(11, 64, -2)
			},
			3: {
				type: 'player',
				username: 'Steve',
				name: 'player',
				position: createVec3(13, 64, -5)
			}
		}
	} as any

	bot.inventory.slots[36] = {
		name: 'iron_pickaxe',
		count: 1,
		maxDurability: 100,
		durabilityUsed: 60
	}
	bot.inventory.slots[45] = {
		name: 'shield',
		count: 1,
		maxDurability: 336,
		durabilityUsed: 36
	}

	const snapshot = buildSnapshot({
		bot,
		currentGoal: 'Build a 5x5 wooden box',
		subGoal: 'Collect 30 oak logs',
		lastAction: 'call_break_block',
		actionResult: 'FAILED',
		reason: 'Unreachable',
		errorHistory: ['Unreachable', 'Unreachable', 'Interrupted by combat']
	})

	assert.match(snapshot, /STATUS/)
	assert.match(snapshot, /dimension: overworld/)
	assert.match(snapshot, /biome: plains/)
	assert.match(snapshot, /time: day/)
	assert.match(snapshot, /INVENTORY_EQUIPMENT/)
	assert.match(snapshot, /free_slots: 34/)
	assert.match(snapshot, /iron_pickaxe x1 \(40%\)/)
	assert.match(snapshot, /main_hand: iron_pickaxe \(40%\)/)
	assert.match(snapshot, /off_hand: shield \(89%\)/)
	assert.match(snapshot, /ENVIRONMENT/)
	assert.match(snapshot, /crafting_table @ 2\.2 -> 12,64,-4/)
	assert.match(snapshot, /oak_log @ 4\.5 -> 14,64,-3/)
	assert.match(snapshot, /zombie @ 5\.0 -> 15,64,-5/)
	assert.match(snapshot, /player:Steve @ 3\.0 -> 13,64,-5/)
	assert.match(snapshot, /GOAL_CONTEXT/)
	assert.match(snapshot, /current_goal: Build a 5x5 wooden box/)
	assert.match(snapshot, /sub_goal: Collect 30 oak logs/)
	assert.match(snapshot, /FEEDBACK_ERRORS/)
	assert.match(snapshot, /last_action: call_break_block/)
	assert.match(snapshot, /action_result: FAILED/)
})

test('buildSnapshot caps environment sections and error history for token discipline', () => {
	const bot = {
		health: 20,
		food: 20,
		oxygenLevel: 20,
		entity: {
			position: createVec3(0, 64, 0)
		},
		game: {
			dimension: 'overworld'
		},
		time: {
			timeOfDay: 18000,
			isDay: false
		},
		inventory: {
			slots: Array.from({ length: 46 }, () => null),
			items: () => []
		},
		getEquipmentDestSlot() {
			return 36
		},
		blockAt(position: { x: number; y: number; z: number }) {
			return {
				name: position.x < 3 ? 'chest' : 'oak_log',
				position,
				biome: {
					name: 'forest'
				}
			}
		},
		findBlocks({
			matching
		}: {
			matching: (block: { name: string }) => boolean
		}) {
			return [
				createVec3(1, 64, 0),
				createVec3(2, 64, 0),
				createVec3(3, 64, 0),
				createVec3(4, 64, 0)
			].filter(position => matching(this.blockAt(position)))
		},
		entities: {
			1: { type: 'hostile', name: 'zombie', position: createVec3(1, 64, 0) },
			2: { type: 'hostile', name: 'skeleton', position: createVec3(2, 64, 0) },
			3: { type: 'mob', name: 'cow', position: createVec3(3, 64, 0) },
			4: { type: 'mob', name: 'pig', position: createVec3(4, 64, 0) }
		}
	} as any

	const snapshot = buildSnapshot({
		bot,
		currentGoal: 'Survive',
		subGoal: null,
		lastAction: null,
		actionResult: 'SUCCESS',
		reason: null,
		errorHistory: ['a', 'b', 'c', 'd'],
		limits: {
			interactables: 1,
			resources: 1,
			entities: 2,
			errorHistory: 3
		}
	})

	assert.equal((snapshot.match(/chest @/g) || []).length, 1)
	assert.equal((snapshot.match(/oak_log @/g) || []).length, 1)
	assert.equal((snapshot.match(/@ [0-9.]+ ->/g) || []).length >= 4, true)
	assert.equal(snapshot.includes('error_history: a | b | c'), true)
	assert.equal(snapshot.includes('error_history: a | b | c | d'), false)
	assert.match(snapshot, /time: night/)
})
