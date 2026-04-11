import fs from 'node:fs/promises'
import path from 'node:path'

import BetterSqlite3 from 'better-sqlite3'

import type {
	ProfileMemoryStoreOptions,
	UserProfilePrompt
} from './types.js'
import {
	createEmptyUserProfilePrompt,
	normalizeUserProfilePrompt
} from './types.js'

type SqliteDatabase = InstanceType<typeof BetterSqlite3>

const DB_VERSION = '1.0.0'

type PromptRow = {
	data_json: string
}

export { createEmptyUserProfilePrompt, normalizeUserProfilePrompt }
export type { ProfileMemoryStoreOptions, UserProfilePrompt }

export class ProfileMemoryStore {
	private readonly botName: string
	private readonly dataDir: string
	private readonly dbPath: string
	private db: SqliteDatabase | null = null
	private profilePrompt: UserProfilePrompt = createEmptyUserProfilePrompt()

	constructor(options: ProfileMemoryStoreOptions) {
		this.botName = options.botName
		this.dataDir = options.dataDir ?? path.resolve('data')
		this.dbPath = path.join(this.dataDir, `bot_profile_${this.botName}.db`)
	}

	async load(): Promise<void> {
		await fs.mkdir(this.dataDir, { recursive: true })
		this.db ??= new BetterSqlite3(this.dbPath)
		this.initializeSchema()
		this.ensureMeta()
		this.profilePrompt = this.readStoredProfilePrompt()
	}

	close(): void {
		this.db?.close()
		this.db = null
	}

	getProfilePrompt(): Readonly<UserProfilePrompt> {
		return {
			...this.profilePrompt,
			behaviorPreferences: [...this.profilePrompt.behaviorPreferences]
		}
	}

	saveProfilePrompt(profilePrompt: UserProfilePrompt): UserProfilePrompt {
		const normalized = normalizeUserProfilePrompt(profilePrompt)
		this.profilePrompt = normalized

		this.getDb()
			.prepare(
				`
					INSERT INTO profile_prompt (id, data_json, updated_at)
					VALUES (1, @data_json, @updated_at)
					ON CONFLICT(id) DO UPDATE SET
						data_json = excluded.data_json,
						updated_at = excluded.updated_at
				`
			)
			.run({
				data_json: JSON.stringify(normalized),
				updated_at: Date.now()
			})

		this.touchMeta('last_updated', new Date().toISOString())
		return this.getProfilePrompt()
	}

	updateProfilePrompt(
		patch: Partial<UserProfilePrompt>
	): Readonly<UserProfilePrompt> {
		return this.saveProfilePrompt({
			...this.profilePrompt,
			...patch,
			behaviorPreferences:
				patch.behaviorPreferences ?? this.profilePrompt.behaviorPreferences
		})
	}

	private getDb(): SqliteDatabase {
		if (!this.db) {
			throw new Error('ProfileMemoryStore is not loaded. Call load() first.')
		}

		return this.db
	}

	private initializeSchema(): void {
		this.getDb().exec(`
			CREATE TABLE IF NOT EXISTS profile_meta (
				key TEXT PRIMARY KEY,
				value TEXT NOT NULL
			);

			CREATE TABLE IF NOT EXISTS profile_prompt (
				id INTEGER PRIMARY KEY CHECK (id = 1),
				data_json TEXT NOT NULL,
				updated_at INTEGER NOT NULL
			);
		`)
	}

	private ensureMeta(): void {
		const createdAt = this.getMetaValue('created_at') ?? new Date().toISOString()
		this.touchMeta('bot_name', this.botName)
		this.touchMeta('created_at', createdAt)
		this.touchMeta('last_updated', new Date().toISOString())
		this.touchMeta('version', DB_VERSION)
	}

	private touchMeta(key: string, value: string): void {
		this.getDb()
			.prepare(
				`
					INSERT INTO profile_meta (key, value)
					VALUES (@key, @value)
					ON CONFLICT(key) DO UPDATE SET value = excluded.value
				`
			)
			.run({ key, value })
	}

	private getMetaValue(key: string): string | null {
		const row = this.getDb()
			.prepare('SELECT value FROM profile_meta WHERE key = ?')
			.get(key) as { value: string } | undefined

		return row?.value ?? null
	}

	private readStoredProfilePrompt(): UserProfilePrompt {
		const row = this.getDb()
			.prepare('SELECT data_json FROM profile_prompt WHERE id = 1')
			.get() as PromptRow | undefined

		if (!row) {
			const empty = createEmptyUserProfilePrompt()
			this.getDb()
				.prepare(
					`
						INSERT INTO profile_prompt (id, data_json, updated_at)
						VALUES (1, @data_json, @updated_at)
					`
				)
				.run({
					data_json: JSON.stringify(empty),
					updated_at: Date.now()
				})
			return empty
		}

		try {
			return normalizeUserProfilePrompt(
				JSON.parse(row.data_json) as Partial<UserProfilePrompt>
			)
		} catch {
			return createEmptyUserProfilePrompt()
		}
	}
}
