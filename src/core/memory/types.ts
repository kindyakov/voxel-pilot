export type JsonPrimitive = string | number | boolean | null
export type JsonValue =
	| JsonPrimitive
	| JsonValue[]
	| {
			[key: string]: JsonValue
	  }

export interface MemoryPosition {
	x: number
	y: number
	z: number
}

export type MemoryEntryType = 'container' | 'location' | 'resource' | 'danger'

export interface MemoryEntry {
	id: string
	type: MemoryEntryType
	position: MemoryPosition
	tags: string[]
	description: string
	data: Record<string, JsonValue>
	updatedAt: number
}

export interface MemoryEntryInput {
	type: MemoryEntryType
	position: MemoryPosition
	tags: string[]
	description: string
	data: Record<string, JsonValue>
}

export interface ReadEntriesQuery {
	queryTags?: string[]
	origin?: MemoryPosition
	maxDistance?: number
}

export interface DeleteEntrySelector {
	id?: string
	position?: MemoryPosition
	type?: MemoryEntryType
}

export interface MemoryManagerOptions {
	botName: string
	dataDir?: string
}

export interface LegacyChestLocation {
	position: MemoryPosition
	type: 'chest' | 'furnace' | 'crafting_table' | 'barrel' | 'shulker_box'
	contents?: string[]
	lastChecked: string
}

export interface LegacyResourceLocation {
	type: string
	position: MemoryPosition
	discovered: string
}

export interface LegacyKnownLocations {
	home?: MemoryPosition
	spawn?: MemoryPosition
	chests: LegacyChestLocation[]
	resources: LegacyResourceLocation[]
}

export interface LegacyPlayerInfo {
	firstMet: string
	lastSeen: string
	interactions: number
	friendly: boolean
	notes: string[]
}

export interface LegacyTaskStats {
	count: number
	successRate: number
	averageTime: number
	lastCompleted: string
}

export interface LegacyDeathRecord {
	timestamp: string
	cause: string
	location: MemoryPosition
	lesson?: string
}

export interface LegacyCurrentGoal {
	goal: string
	priority: number
	startedAt: string
	tasks: Array<{ type: string; params: Record<string, unknown> }>
	currentTaskIndex?: number
	progress?: Record<string, unknown>
}

export interface LegacyCompletedGoal {
	goal: string
	completedAt: string
	duration: number
	tasksCompleted: number
}

export interface LegacyFailedGoal {
	goal: string
	failedAt: string
	reason: string
	tasksAttempted: number
}

export interface LegacyBotMemoryData {
	meta: {
		botName: string
		createdAt: string
		lastUpdated: string
		version: string
	}
	world: {
		knownLocations: LegacyKnownLocations
		knownPlayers: Record<string, LegacyPlayerInfo>
	}
	experience: {
		tasksCompleted: Record<string, LegacyTaskStats>
		deaths: LegacyDeathRecord[]
		achievements?: string[]
	}
	goals: {
		current?: LegacyCurrentGoal
		completed: LegacyCompletedGoal[]
		failed: LegacyFailedGoal[]
	}
	preferences?: {
		favoriteTools?: string[]
		avoidAreas?: MemoryPosition[]
		preferredMiningDepth?: number
	}
	stats: {
		totalPlaytime: number
		blocksMined: Record<string, number>
		blocksPlaced: Record<string, number>
		itemsCrafted?: Record<string, number>
		mobsKilled?: Record<string, number>
		distanceTraveled: number
	}
}
