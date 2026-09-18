import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'

import { MemoryManager } from '@/core/memory/index.js'
import { normalizeTaskDone } from '@/core/memory/types.js'
import type { MemoryEntryInput } from '@/core/memory/types.js'

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

test('deleteEntry by position respects the optional type filter', async () => {
	const dataDir = await createTempDataDir()
	const manager = new MemoryManager({
		botName: 'TestBot',
		dataDir
	})

	await manager.load()

	const position = { x: 1, y: 2, z: 3 }
	manager.saveEntry({
		type: 'resource',
		position,
		tags: ['iron'],
		description: 'Iron vein',
		data: {}
	})
	manager.saveEntry({
		type: 'container',
		position,
		tags: ['chest'],
		description: 'Chest at the same spot',
		data: {}
	})

	assert.equal(manager.deleteEntry({ position, type: 'resource' }), true)
	assert.equal(manager.readEntries({}).length, 1)
	assert.equal(manager.deleteEntry({ position }), true)
	assert.equal(manager.readEntries({}).length, 0)
	assert.equal(manager.deleteEntry({ position: { x: 9, y: 9, z: 9 } }), false)
	manager.close()
})

test('save persists players, task stats and completed goals across restarts', async () => {
	const dataDir = await createTempDataDir()
	const manager = new MemoryManager({
		botName: 'PersistentBot',
		dataDir
	})

	await manager.load()

	manager.rememberPlayer('Steve', { friendly: true })
	manager.rememberTask('mining', true, 120)
	manager.setCurrentGoal({
		goal: 'Mine diamonds',
		priority: 1,
		startedAt: new Date().toISOString(),
		tasks: []
	})
	manager.completeCurrentGoal()
	await manager.save()
	manager.close()

	const restarted = new MemoryManager({
		botName: 'PersistentBot',
		dataDir
	})
	await restarted.load()

	const memory = restarted.getMemory()
	assert.equal(memory.world.knownPlayers['Steve']?.interactions, 1)
	assert.equal(memory.world.knownPlayers['Steve']?.friendly, true)
	assert.equal(memory.experience.tasksCompleted['mining']?.count, 1)
	assert.equal(memory.goals.completed.length, 1)
	assert.equal(memory.goals.completed[0]?.goal, 'Mine diamonds')
	assert.equal(memory.goals.current, undefined)
	restarted.close()
})

test('normalizeTaskDone coerces garbage before capping by total', () => {
	assert.equal(normalizeTaskDone(3, 5), 3)
	assert.equal(normalizeTaskDone(7, 5), 5)
	assert.equal(normalizeTaskDone(-3, 5), 0)
	assert.equal(normalizeTaskDone(2.5, 5), 0)
	assert.equal(normalizeTaskDone(Number.NaN, 5), 0)
	assert.equal(normalizeTaskDone(Number.POSITIVE_INFINITY, 5), 0)
	assert.equal(normalizeTaskDone('3' as any, 5), 0)
})

test('task records persist progress and status across restarts', async () => {
	const dataDir = await createTempDataDir()
	const manager = new MemoryManager({ botName: 'TaskBot', dataDir })
	await manager.load()

	const created = manager.createTask({
		kind: 'mining',
		blockName: 'iron_ore',
		resourceName: 'raw_iron',
		total: 5
	})
	assert.equal(created.status, 'suspended')
	assert.equal(created.done, 0)

	manager.setTaskStatus(created.id, 'active')
	manager.updateTaskProgress(created.id, 3)
	assert.deepEqual(
		manager.listTasks({ status: 'active' }).map(task => task.id),
		[created.id]
	)

	manager.close()

	const restarted = new MemoryManager({ botName: 'TaskBot', dataDir })
	await restarted.load()

	const record = restarted.getTask(created.id)
	assert.equal(record?.status, 'active')
	assert.equal(record?.done, 3)
	assert.equal(record?.blockName, 'iron_ore')
	assert.equal(record?.resourceName, 'raw_iron')
	assert.equal(record?.total, 5)

	restarted.setTaskStatus(created.id, 'completed')
	assert.equal(restarted.listTasks({ status: 'suspended' }).length, 0)
	assert.equal(restarted.updateTaskProgress('missing', 1), null)
	assert.equal(restarted.setTaskStatus('missing', 'cancelled'), null)
	restarted.close()
})

test('v1 task schema migrates without changing stored progress or inventing an output', async () => {
	const dataDir = await createTempDataDir()
	const raw = new DatabaseSync(path.join(dataDir, 'bot_memory_MigrationBot.db'))
	raw.exec(`CREATE TABLE bot_tasks (id TEXT PRIMARY KEY, kind TEXT NOT NULL, status TEXT NOT NULL, block_name TEXT NOT NULL, total INTEGER NOT NULL, done INTEGER NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
		INSERT INTO bot_tasks VALUES ('old', 'mining', 'suspended', 'coal_ore', 10, 6, 0, 0);`)
	raw.close()
	const manager = new MemoryManager({ botName: 'MigrationBot', dataDir })
	await manager.load()
	try {
		assert.equal(manager.getTask('old')?.done, 6)
		assert.equal(manager.getTask('old')?.resourceName, undefined)
		const exact = manager.createTask({
			kind: 'mining',
			blockName: 'coal_ore',
			resourceName: 'coal_ore',
			total: 10
		})
		assert.equal(manager.getTask(exact.id)?.resourceName, 'coal_ore')
	} finally {
		manager.close()
	}
})

test('normalizeTasksOnBoot suspends crashed active rows and keeps progress', async () => {
	const dataDir = await createTempDataDir()
	const manager = new MemoryManager({ botName: 'CrashBot', dataDir })
	await manager.load()

	const crashed = manager.createTask({
		kind: 'mining',
		blockName: 'diamond_ore',
		total: 4
	})
	manager.setTaskStatus(crashed.id, 'active')
	manager.updateTaskProgress(crashed.id, 2)
	const calm = manager.createTask({
		kind: 'mining',
		blockName: 'stone',
		total: 9
	})
	manager.close()

	const restarted = new MemoryManager({ botName: 'CrashBot', dataDir })
	await restarted.load()
	const recovered = restarted.normalizeTasksOnBoot()

	assert.equal(recovered, 1)
	assert.equal(restarted.getTask(crashed.id)?.status, 'suspended')
	assert.equal(restarted.getTask(crashed.id)?.done, 2)
	assert.equal(restarted.getTask(calm.id)?.status, 'suspended')
	restarted.close()
})

test('task mutations persist without invoking runtime-state save', async t => {
	const dataDir = await createTempDataDir()
	const manager = new MemoryManager({ botName: 'TaskWriteBot', dataDir })
	await manager.load()
	let saves = 0
	t.mock.method(manager, 'save', async () => {
		saves += 1
		throw new Error('runtime metadata unavailable')
	})

	const created = manager.createTask({
		kind: 'mining',
		blockName: 'iron_ore',
		total: 3
	})
	manager.setTaskStatus(created.id, 'active')
	manager.updateTaskProgress(created.id, 2)

	assert.equal(saves, 0)
	manager.close()

	const restarted = new MemoryManager({ botName: 'TaskWriteBot', dataDir })
	await restarted.load()
	assert.equal(restarted.getTask(created.id)?.status, 'active')
	assert.equal(restarted.getTask(created.id)?.done, 2)
	restarted.close()
})

test('task reader tolerates legacy rows without throwing', async () => {
	const dataDir = await createTempDataDir()
	const manager = new MemoryManager({ botName: 'LegacyBot', dataDir })
	await manager.load()
	manager.close()

	const raw = new DatabaseSync(path.join(dataDir, 'bot_memory_LegacyBot.db'))
	try {
		raw
			.prepare(
				`
					INSERT INTO bot_tasks (
						id, kind, status, block_name, total, done, created_at, updated_at
					)
					VALUES
						('legacy-unknown-status', 'mining', 'running', 'iron_ore', 5, 'three', 0, 0),
						('legacy-bad-total', 'mining', 'suspended', 'iron_ore', 'lots', 1, 0, 0),
						('legacy-foreign-kind', 'farming', 'suspended', 'wheat', 5, 1, 0, 0),
						('legacy-overflow-done', 'mining', 'suspended', 'stone', 5, 9223372036854775807, 9223372036854775807, 9223372036854775807),
						('legacy-overflow-total', 'mining', 'suspended', 'dirt', 9223372036854775807, 1, 0, 0)
				`
			)
			.run()
	} finally {
		raw.close()
	}

	const reader = new MemoryManager({ botName: 'LegacyBot', dataDir })
	await reader.load()

	const tasks = reader.listTasks()
	assert.equal(tasks.length, 2)
	const unknownStatus = tasks.find(task => task.id === 'legacy-unknown-status')
	assert.equal(unknownStatus?.status, 'suspended')
	assert.equal(unknownStatus?.done, 0)
	const overflowDone = tasks.find(task => task.id === 'legacy-overflow-done')
	assert.equal(overflowDone?.done, 0)
	assert.equal(overflowDone?.createdAt, 0)
	assert.equal(overflowDone?.updatedAt, 0)
	assert.equal(reader.getTask('legacy-overflow-done')?.done, 0)
	assert.equal(reader.getTask('legacy-overflow-total'), null)
	// A row that degrades to `suspended` must also match the suspended filter.
	assert.deepEqual(
		reader
			.listTasks({ status: 'suspended' })
			.map(task => task.id)
			.sort(),
		['legacy-overflow-done', 'legacy-unknown-status']
	)
	assert.equal(reader.listTasks({ status: 'active' }).length, 0)
	assert.equal(reader.normalizeTasksOnBoot(), 1)
	assert.equal(reader.getTask('legacy-unknown-status')?.status, 'suspended')
	reader.close()
})
