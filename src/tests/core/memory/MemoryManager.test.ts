import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { MemoryManager } from '../../../core/memory/index.js'
import type {
	LegacyBotMemoryData,
	MemoryEntryInput
} from '../../../core/memory/types.js'

const createTempDataDir = async (): Promise<string> => {
	return fs.mkdtemp(path.join(os.tmpdir(), 'minecraft-bot-memory-'))
}

const createLegacyMemory = (botName: string): LegacyBotMemoryData => ({
	meta: {
		botName,
		createdAt: '2026-03-01T00:00:00.000Z',
		lastUpdated: '2026-03-01T00:00:00.000Z',
		version: '1.0.0'
	},
	world: {
		knownLocations: {
			home: { x: 100, y: 64, z: 100 },
			spawn: { x: 0, y: 64, z: 0 },
			chests: [
				{
					position: { x: 101, y: 64, z: 100 },
					type: 'chest',
					contents: ['oak_log: 32'],
					lastChecked: '2026-03-01T00:10:00.000Z'
				}
			],
			resources: [
				{
					type: 'oak_log',
					position: { x: 130, y: 70, z: 110 },
					discovered: '2026-03-01T00:20:00.000Z'
				}
			]
		},
		knownPlayers: {}
	},
	experience: {
		tasksCompleted: {},
		deaths: []
	},
	goals: {
		completed: [],
		failed: []
	},
	stats: {
		totalPlaytime: 0,
		blocksMined: {},
		blocksPlaced: {},
		distanceTraveled: 0
	}
})

test('saveEntry upserts same type and position and readEntries filters by tag and distance', async () => {
	const dataDir = await createTempDataDir()
	const manager = new MemoryManager({
		botName: 'TestBot',
		dataDir
	})

	await manager.load()

	const chestInput: MemoryEntryInput = {
		type: 'container',
		position: { x: 10, y: 64, z: 10 },
		tags: ['storage', 'home'],
		description: 'Main base chest',
		data: {
			blockName: 'chest'
		}
	}

	const first = manager.saveEntry(chestInput)
	const second = manager.saveEntry({
		...chestInput,
		description: 'Updated base chest',
		data: {
			blockName: 'chest',
			items: ['oak_log:32']
		}
	})

	assert.equal(first.id, second.id)
	assert.equal(second.description, 'Updated base chest')

	const nearbyStorage = manager.readEntries({
		queryTags: ['storage'],
		origin: { x: 0, y: 64, z: 0 },
		maxDistance: 32
	})

	assert.equal(nearbyStorage.length, 1)
	assert.equal(nearbyStorage[0]?.id, second.id)
	assert.deepEqual(nearbyStorage[0]?.tags, ['storage', 'home'])
})

test('updateEntryData and deleteEntry mutate persisted records', async () => {
	const dataDir = await createTempDataDir()
	const manager = new MemoryManager({
		botName: 'TestBot',
		dataDir
	})

	await manager.load()

	const entry = manager.saveEntry({
		type: 'resource',
		position: { x: 25, y: 12, z: -5 },
		tags: ['wood'],
		description: 'Nearby spruce tree',
		data: {
			blockName: 'spruce_log'
		}
	})

	const updated = manager.updateEntryData(entry.id, {
		blockName: 'spruce_log',
		notes: ['harvested once']
	})

	assert.equal(updated?.id, entry.id)
	assert.deepEqual(updated?.data, {
		blockName: 'spruce_log',
		notes: ['harvested once']
	})

	assert.equal(manager.deleteEntry({ id: entry.id }), true)
	assert.equal(
		manager.readEntries({
			queryTags: ['wood']
		}).length,
		0
	)
})

test('load migrates legacy JSON memory into sqlite entries and creates backup once', async () => {
	const dataDir = await createTempDataDir()
	const botName = 'MigratingBot'
	const legacyPath = path.join(dataDir, `bot_memory_${botName}.json`)

	await fs.writeFile(
		legacyPath,
		JSON.stringify(createLegacyMemory(botName), null, 2),
		'utf8'
	)

	const manager = new MemoryManager({
		botName,
		dataDir
	})

	await manager.load()

	const imported = manager.readEntries({})
	assert.equal(imported.length, 4)
	assert.deepEqual(imported.map(entry => entry.type).sort(), [
		'container',
		'location',
		'location',
		'resource'
	])

	const backups = await fs.readdir(dataDir)
	assert.equal(
		backups.some(fileName =>
			fileName.startsWith(`bot_memory_${botName}.backup_`)
		),
		true
	)
})
