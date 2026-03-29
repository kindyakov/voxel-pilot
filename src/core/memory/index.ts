import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

import BetterSqlite3 from 'better-sqlite3'

import type {
	BotMemoryData,
	ChestLocation,
	CurrentGoal,
	DeleteEntrySelector,
	KnownLocations,
	MemoryEntry,
	MemoryEntryInput,
	MemoryManagerOptions,
	MemoryPosition,
	ReadEntriesQuery,
	TaskStats
} from './types.js'

type SqliteDatabase = InstanceType<typeof BetterSqlite3>

const DB_VERSION = '2.0.0'

const distanceBetween = (a: MemoryPosition, b: MemoryPosition): number => {
	const dx = a.x - b.x
	const dy = a.y - b.y
	const dz = a.z - b.z
	return Math.sqrt(dx * dx + dy * dy + dz * dz)
}

const normalizeTags = (tags: string[]): string[] =>
	Array.from(new Set(tags.map(tag => tag.trim()).filter(Boolean)))

const serialize = (value: unknown): string => JSON.stringify(value ?? {})

const parseJsonObject = (value: string): Record<string, any> => {
	const parsed = JSON.parse(value) as unknown
	if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
		return parsed as Record<string, any>
	}

	return {}
}

type EntryRow = {
	id: string
	type: MemoryEntry['type']
	x: number
	y: number
	z: number
	tags_json: string
	description: string
	data_json: string
	updated_at: number
}

type MetaRow = {
	value: string
}

export class MemoryManager {
	private readonly botName: string
	private readonly dataDir: string
	private readonly dbPath: string
	private db: SqliteDatabase | null = null
	private memoryState: BotMemoryData

	constructor(options: MemoryManagerOptions) {
		this.botName = options.botName
		this.dataDir = options.dataDir ?? path.resolve('data')
		this.dbPath = path.join(this.dataDir, `bot_memory_${this.botName}.db`)
		this.memoryState = this.createDefaultState()
	}

	async load(): Promise<void> {
		await fs.mkdir(this.dataDir, { recursive: true })
		this.db ??= new BetterSqlite3(this.dbPath)
		this.initializeSchema()
		this.ensureMeta()
	}

	async save(): Promise<void> {
		this.touchMeta('last_updated', new Date().toISOString())
	}

	close(): void {
		this.db?.close()
		this.db = null
	}

	saveEntry(input: MemoryEntryInput): MemoryEntry {
		const db = this.getDb()
		const existing = db
			.prepare(
				`
					SELECT id
					FROM memory_entries
					WHERE type = @type AND x = @x AND y = @y AND z = @z
				`
			)
			.get({
				type: input.type,
				x: input.position.x,
				y: input.position.y,
				z: input.position.z
			}) as { id: string } | undefined

		const entryId = existing?.id ?? randomUUID()
		const tags = normalizeTags(input.tags)
		const updatedAt = Date.now()

		db.prepare(
			`
				INSERT INTO memory_entries (
					id, type, x, y, z, tags_json, description, data_json, updated_at
				)
				VALUES (
					@id, @type, @x, @y, @z, @tags_json, @description, @data_json, @updated_at
				)
				ON CONFLICT(type, x, y, z) DO UPDATE SET
					tags_json = excluded.tags_json,
					description = excluded.description,
					data_json = excluded.data_json,
					updated_at = excluded.updated_at
			`
		).run({
			id: entryId,
			type: input.type,
			x: input.position.x,
			y: input.position.y,
			z: input.position.z,
			tags_json: serialize(tags),
			description: input.description,
			data_json: serialize(input.data),
			updated_at: updatedAt
		})

		void this.save()

		return this.getEntryById(entryId)!
	}

	readEntries(query: ReadEntriesQuery): MemoryEntry[] {
		const db = this.getDb()
		const rows = db
			.prepare(
				`
					SELECT id, type, x, y, z, tags_json, description, data_json, updated_at
					FROM memory_entries
					ORDER BY updated_at DESC
				`
			)
			.all() as EntryRow[]

		return rows
			.map(row => this.mapRowToEntry(row))
			.filter(entry => {
				if (query.queryTags?.length) {
					const requiredTags = normalizeTags(query.queryTags)
					if (!requiredTags.every(tag => entry.tags.includes(tag))) {
						return false
					}
				}

				if (query.origin && typeof query.maxDistance === 'number') {
					return (
						distanceBetween(entry.position, query.origin) <= query.maxDistance
					)
				}

				return true
			})
	}

	updateEntryData(id: string, data: Record<string, any>): MemoryEntry | null {
		const db = this.getDb()
		const current = this.getEntryById(id)
		if (!current) {
			return null
		}

		db.prepare(
			`
				UPDATE memory_entries
				SET data_json = @data_json, updated_at = @updated_at
				WHERE id = @id
			`
		).run({
			id,
			data_json: serialize(data),
			updated_at: Date.now()
		})

		void this.save()

		return this.getEntryById(id)
	}

	deleteEntry(selector: DeleteEntrySelector): boolean {
		const db = this.getDb()

		if (selector.id) {
			const result = db
				.prepare('DELETE FROM memory_entries WHERE id = ?')
				.run(selector.id)
			void this.save()
			return result.changes > 0
		}

		if (selector.position) {
			const result = db
				.prepare(
					`
						DELETE FROM memory_entries
						WHERE x = @x AND y = @y AND z = @z
						${selector.type ? 'AND type = @type' : ''}
					`
				)
				.run({
					x: selector.position.x,
					y: selector.position.y,
					z: selector.position.z,
					type: selector.type
				})
			void this.save()
			return result.changes > 0
		}

		return false
	}

	rememberLocation(
		type: 'chest' | 'resource' | 'home' | 'spawn',
		position: MemoryPosition,
		metadata?: Record<string, any>
	): void {
		if (type === 'home' || type === 'spawn') {
			this.saveEntry({
				type: 'location',
				position,
				tags: [type],
				description:
					type === 'home' ? 'Bot home position' : 'Bot spawn position',
				data: {}
			})
			return
		}

		if (type === 'chest') {
			const containerType = String(metadata?.containerType ?? 'chest')
			this.saveEntry({
				type: 'container',
				position,
				tags: [containerType],
				description: `Known ${containerType}`,
				data: {
					containerType,
					contents: (metadata?.contents as string[] | undefined) ?? []
				}
			})
			return
		}

		const resourceType = String(metadata?.resourceType ?? 'unknown')
		this.saveEntry({
			type: 'resource',
			position,
			tags: [resourceType],
			description: `Known ${resourceType}`,
			data: {
				resourceType
			}
		})
	}

	findNearestKnown(
		type: 'chest' | 'resource' | 'home' | 'spawn',
		currentPosition: MemoryPosition,
		filter?: Record<string, any>
	): MemoryPosition | null {
		const queryTags =
			type === 'home' || type === 'spawn'
				? [type]
				: type === 'chest'
					? filter?.containerType
						? [String(filter.containerType)]
						: []
					: filter?.resourceType
						? [String(filter.resourceType)]
						: []

		const targetType =
			type === 'home' || type === 'spawn'
				? 'location'
				: type === 'chest'
					? 'container'
					: 'resource'

		const candidates = this.readEntries({
			queryTags,
			origin: currentPosition,
			maxDistance: Number.MAX_SAFE_INTEGER
		}).filter(entry => entry.type === targetType)

		if (candidates.length === 0) {
			return null
		}

		return (
			candidates.sort(
				(a, b) =>
					distanceBetween(a.position, currentPosition) -
					distanceBetween(b.position, currentPosition)
			)[0]?.position ?? null
		)
	}

	rememberPlayer(username: string, metadata?: Record<string, any>): void {
		const existing = this.memoryState.world.knownPlayers[username]
		if (existing) {
			existing.lastSeen = new Date().toISOString()
			existing.interactions += 1
			if (typeof metadata?.friendly === 'boolean') {
				existing.friendly = metadata.friendly
			}
			if (Array.isArray(metadata?.notes)) {
				existing.notes.push(...metadata.notes)
			}
			return
		}

		this.memoryState.world.knownPlayers[username] = {
			firstMet: new Date().toISOString(),
			lastSeen: new Date().toISOString(),
			interactions: 1,
			friendly:
				typeof metadata?.friendly === 'boolean' ? metadata.friendly : true,
			notes: Array.isArray(metadata?.notes) ? metadata.notes : []
		}
	}

	rememberTask(taskType: string, success: boolean, duration: number): void {
		const existing = this.memoryState.experience.tasksCompleted[taskType]
		if (existing) {
			existing.count += 1
			const totalSuccess = existing.successRate * (existing.count - 1)
			existing.successRate = (totalSuccess + (success ? 1 : 0)) / existing.count
			const totalTime = existing.averageTime * (existing.count - 1)
			existing.averageTime = (totalTime + duration) / existing.count
			existing.lastCompleted = new Date().toISOString()
			return
		}

		this.memoryState.experience.tasksCompleted[taskType] = {
			count: 1,
			successRate: success ? 1 : 0,
			averageTime: duration,
			lastCompleted: new Date().toISOString()
		}
	}

	rememberDeath(
		cause: string,
		location: MemoryPosition,
		lesson?: string
	): void {
		this.memoryState.experience.deaths.push({
			timestamp: new Date().toISOString(),
			cause,
			location,
			lesson
		})
	}

	updateStats(
		type: 'mined' | 'placed' | 'crafted' | 'killed',
		item: string,
		count: number
	): void {
		switch (type) {
			case 'mined':
				this.memoryState.stats.blocksMined[item] =
					(this.memoryState.stats.blocksMined[item] || 0) + count
				break
			case 'placed':
				this.memoryState.stats.blocksPlaced[item] =
					(this.memoryState.stats.blocksPlaced[item] || 0) + count
				break
			case 'crafted':
				this.memoryState.stats.itemsCrafted =
					this.memoryState.stats.itemsCrafted || {}
				this.memoryState.stats.itemsCrafted[item] =
					(this.memoryState.stats.itemsCrafted[item] || 0) + count
				break
			case 'killed':
				this.memoryState.stats.mobsKilled =
					this.memoryState.stats.mobsKilled || {}
				this.memoryState.stats.mobsKilled[item] =
					(this.memoryState.stats.mobsKilled[item] || 0) + count
				break
		}
	}

	updateDistance(distance: number): void {
		this.memoryState.stats.distanceTraveled += distance
	}

	updatePlaytime(playtime: number): void {
		this.memoryState.stats.totalPlaytime += playtime
	}

	setCurrentGoal(goal: CurrentGoal): void {
		this.memoryState.goals.current = goal
	}

	completeCurrentGoal(): void {
		const current = this.memoryState.goals.current
		if (!current) {
			return
		}

		this.memoryState.goals.completed.push({
			goal: current.goal,
			completedAt: new Date().toISOString(),
			duration: Date.now() - new Date(current.startedAt).getTime(),
			tasksCompleted: current.currentTaskIndex || 0
		})
		this.memoryState.goals.current = undefined
	}

	failCurrentGoal(reason: string): void {
		const current = this.memoryState.goals.current
		if (!current) {
			return
		}

		this.memoryState.goals.failed.push({
			goal: current.goal,
			failedAt: new Date().toISOString(),
			reason,
			tasksAttempted: current.currentTaskIndex || 0
		})
		this.memoryState.goals.current = undefined
	}

	getMemory(): Readonly<BotMemoryData> {
		return {
			...this.memoryState,
			meta: {
				...this.memoryState.meta,
				lastUpdated:
					this.getMetaValue('last_updated') ?? new Date().toISOString(),
				version: DB_VERSION
			},
			world: {
				...this.memoryState.world,
				knownLocations: this.deriveKnownLocations()
			}
		}
	}

	getKnownLocations(): Readonly<KnownLocations> {
		return this.deriveKnownLocations()
	}

	getTaskStats(taskType: string): TaskStats | undefined {
		return this.memoryState.experience.tasksCompleted[taskType]
	}

	getStats(): Readonly<BotMemoryData['stats']> {
		return this.memoryState.stats
	}

	private getDb(): SqliteDatabase {
		if (!this.db) {
			throw new Error('MemoryManager is not loaded. Call load() first.')
		}

		return this.db
	}

	private initializeSchema(): void {
		const db = this.getDb()
		db.exec(`
			CREATE TABLE IF NOT EXISTS memory_meta (
				key TEXT PRIMARY KEY,
				value TEXT NOT NULL
			);

			CREATE TABLE IF NOT EXISTS memory_entries (
				id TEXT PRIMARY KEY,
				type TEXT NOT NULL,
				x INTEGER NOT NULL,
				y INTEGER NOT NULL,
				z INTEGER NOT NULL,
				tags_json TEXT NOT NULL,
				description TEXT NOT NULL,
				data_json TEXT NOT NULL,
				updated_at INTEGER NOT NULL,
				UNIQUE(type, x, y, z)
			);

			CREATE INDEX IF NOT EXISTS idx_memory_entries_updated_at
			ON memory_entries(updated_at DESC);
		`)
	}

	private ensureMeta(): void {
		const createdAt =
			this.getMetaValue('created_at') ?? new Date().toISOString()
		this.touchMeta('bot_name', this.botName)
		this.touchMeta('created_at', createdAt)
		this.touchMeta('last_updated', new Date().toISOString())
		this.touchMeta('version', DB_VERSION)
	}

	private touchMeta(key: string, value: string): void {
		this.getDb()
			.prepare(
				`
					INSERT INTO memory_meta (key, value)
					VALUES (@key, @value)
					ON CONFLICT(key) DO UPDATE SET value = excluded.value
				`
			)
			.run({ key, value })
	}

	private getMetaValue(key: string): string | null {
		const row = this.getDb()
			.prepare('SELECT value FROM memory_meta WHERE key = ?')
			.get(key) as MetaRow | undefined

		return row?.value ?? null
	}

	private getEntryById(id: string): MemoryEntry | null {
		const row = this.getDb()
			.prepare(
				`
					SELECT id, type, x, y, z, tags_json, description, data_json, updated_at
					FROM memory_entries
					WHERE id = ?
				`
			)
			.get(id) as EntryRow | undefined

		return row ? this.mapRowToEntry(row) : null
	}

	private mapRowToEntry(row: EntryRow): MemoryEntry {
		return {
			id: row.id,
			type: row.type,
			position: {
				x: row.x,
				y: row.y,
				z: row.z
			},
			tags: JSON.parse(row.tags_json) as string[],
			description: row.description,
			data: parseJsonObject(row.data_json),
			updatedAt: row.updated_at
		}
	}

	private deriveKnownLocations(): KnownLocations {
		const entries = this.readEntries({})
		const knownLocations: KnownLocations = {
			chests: [],
			resources: []
		}

		for (const entry of entries) {
			if (entry.type === 'location' && entry.tags.includes('home')) {
				knownLocations.home = entry.position
				continue
			}

			if (entry.type === 'location' && entry.tags.includes('spawn')) {
				knownLocations.spawn = entry.position
				continue
			}

			if (entry.type === 'container') {
				knownLocations.chests.push({
					position: entry.position,
					type: this.resolveContainerType(entry.tags),
					contents: Array.isArray(entry.data.contents)
						? (entry.data.contents as string[])
						: undefined,
					lastChecked:
						typeof entry.data.lastChecked === 'string'
							? entry.data.lastChecked
							: new Date(entry.updatedAt).toISOString()
				})
				continue
			}

			if (entry.type === 'resource') {
				knownLocations.resources.push({
					type:
						typeof entry.data.resourceType === 'string'
							? entry.data.resourceType
							: (entry.tags[0] ?? 'unknown'),
					position: entry.position,
					discovered:
						typeof entry.data.discovered === 'string'
							? entry.data.discovered
							: new Date(entry.updatedAt).toISOString()
				})
			}
		}

		return knownLocations
	}

	private resolveContainerType(tags: string[]): ChestLocation['type'] {
		const matched =
			tags.find(tag =>
				[
					'chest',
					'furnace',
					'crafting_table',
					'barrel',
					'shulker_box'
				].includes(tag)
			) ?? 'chest'

		return matched as ChestLocation['type']
	}

	private createDefaultState(): BotMemoryData {
		const now = new Date().toISOString()
		return {
			meta: {
				botName: this.botName,
				createdAt: now,
				lastUpdated: now,
				version: DB_VERSION
			},
			world: {
				knownLocations: {
					chests: [],
					resources: []
				},
				knownPlayers: {}
			},
			experience: {
				tasksCompleted: {},
				deaths: [],
				achievements: []
			},
			goals: {
				completed: [],
				failed: []
			},
			preferences: {
				favoriteTools: [],
				avoidAreas: [],
				preferredMiningDepth: 12
			},
			stats: {
				totalPlaytime: 0,
				blocksMined: {},
				blocksPlaced: {},
				itemsCrafted: {},
				mobsKilled: {},
				distanceTraveled: 0
			}
		}
	}
}
