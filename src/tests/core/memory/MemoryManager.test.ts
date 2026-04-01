import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { MemoryManager } from '../../../core/memory/index.js'
import type { MemoryEntryInput } from '../../../core/memory/types.js'

const createTempDataDir = async (): Promise<string> => {
	return fs.mkdtemp(path.join(os.tmpdir(), 'minecraft-bot-memory-'))
}

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

test('load ignores legacy JSON memory file and does not create backup', async () => {
	const dataDir = await createTempDataDir()
	const botName = 'MigratingBot'
	const legacyPath = path.join(dataDir, `bot_memory_${botName}.json`)

	await fs.writeFile(
		legacyPath,
		JSON.stringify({ legacy: true }, null, 2),
		'utf8'
	)

	const manager = new MemoryManager({
		botName,
		dataDir
	})

	await manager.load()

	assert.equal(manager.readEntries({}).length, 0)

	const backups = await fs.readdir(dataDir)
	assert.equal(
		backups.some(fileName =>
			fileName.startsWith(`bot_memory_${botName}.backup_`)
		),
		false
	)
})
