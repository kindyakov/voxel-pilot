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

export interface ChestLocation {
	position: MemoryPosition
	type: 'chest' | 'furnace' | 'crafting_table' | 'barrel' | 'shulker_box'
	contents?: string[]
	lastChecked: string
}

export interface ResourceLocation {
	type: string
	position: MemoryPosition
	discovered: string
}

export interface KnownLocations {
	home?: MemoryPosition
	spawn?: MemoryPosition
	chests: ChestLocation[]
	resources: ResourceLocation[]
}

export interface PlayerInfo {
	firstMet: string
	lastSeen: string
	interactions: number
	friendly: boolean
	notes: string[]
}

export interface TaskStats {
	count: number
	successRate: number
	averageTime: number
	lastCompleted: string
}

export interface DeathRecord {
	timestamp: string
	cause: string
	location: MemoryPosition
	lesson?: string
}

export interface CurrentGoal {
	goal: string
	priority: number
	startedAt: string
	tasks: Array<{ type: string; params: Record<string, unknown> }>
	currentTaskIndex?: number
	progress?: Record<string, unknown>
}

export interface CompletedGoal {
	goal: string
	completedAt: string
	duration: number
	tasksCompleted: number
}

export interface FailedGoal {
	goal: string
	failedAt: string
	reason: string
	tasksAttempted: number
}

export interface BotMemoryData {
	meta: {
		botName: string
		createdAt: string
		lastUpdated: string
		version: string
	}
	world: {
		knownLocations: KnownLocations
		knownPlayers: Record<string, PlayerInfo>
	}
	experience: {
		tasksCompleted: Record<string, TaskStats>
		deaths: DeathRecord[]
		achievements?: string[]
	}
	goals: {
		current?: CurrentGoal
		completed: CompletedGoal[]
		failed: FailedGoal[]
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
