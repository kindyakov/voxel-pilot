import fs from 'fs/promises'
import path from 'path'

import type { Bot, Vec3 } from '@types'

/** Локация сундука/печи/верстака */
interface ChestLocation {
	position: Vec3
	type: 'chest' | 'furnace' | 'crafting_table' | 'barrel' | 'shulker_box'
	contents?: string[] // Что примерно лежит внутри
	lastChecked: string // ISO дата
}

/** Локация ресурса */
interface ResourceLocation {
	type: string // 'iron_ore', 'coal', 'diamond_ore', etc.
	position: Vec3
	discovered: string // ISO дата
}

/** Известные локации */
interface KnownLocations {
	home?: Vec3
	spawn?: Vec3
	chests: ChestLocation[]
	resources: ResourceLocation[]
}

/** Информация об игроке */
interface PlayerInfo {
	firstMet: string // ISO дата
	lastSeen: string // ISO дата
	interactions: number
	friendly: boolean
	notes: string[]
}

/** Статистика задачи */
interface TaskStats {
	count: number // Сколько раз выполнялась
	successRate: number // 0.0 - 1.0
	averageTime: number // milliseconds
	lastCompleted: string // ISO дата
}

/** Запись о смерти */
interface DeathRecord {
	timestamp: string // ISO дата
	cause: string
	location: Vec3
	lesson?: string
}

/** Текущая цель */
interface CurrentGoal {
	goal: string
	priority: number
	startedAt: string // ISO дата
	tasks: Array<{ type: string; params: Record<string, any> }>
	currentTaskIndex?: number
	progress?: Record<string, any> // Прогресс текущей задачи
}

/** Завершённая цель */
interface CompletedGoal {
	goal: string
	completedAt: string // ISO дата
	duration: number // milliseconds
	tasksCompleted: number
}

/** Проваленная цель */
interface FailedGoal {
	goal: string
	failedAt: string // ISO дата
	reason: string
	tasksAttempted: number
}

/** Основная структура памяти */
interface BotMemoryData {
	meta: {
		botName: string
		createdAt: string
		lastUpdated: string
		version: string
	}

	world: {
		knownLocations: KnownLocations
		knownPlayers: Record<string, PlayerInfo> // Map сериализуется как объект
	}

	experience: {
		tasksCompleted: Record<string, TaskStats> // Map → объект
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
		avoidAreas?: Vec3[]
		preferredMiningDepth?: number
	}

	stats: {
		totalPlaytime: number
		blocksMined: Record<string, number> // Map → объект
		blocksPlaced: Record<string, number> // Map → объект
		itemsCrafted?: Record<string, number>
		mobsKilled?: Record<string, number>
		distanceTraveled: number
	}
}

// ============================================================================
// Класс BotMemory
// ============================================================================

export default class BotMemory {
	private memory: BotMemoryData
	private filePath: string
	private botName: string
	private dataDir: string

	constructor(botName: string) {
		this.botName = botName
		this.dataDir = path.resolve('data')
		this.filePath = path.join(this.dataDir, `bot_memory_${botName}.json`)
		this.memory = this.createDefaultMemory()
	}

	/**
	 * Загрузить память из файла
	 * Если файл не существует → создать дефолтную память
	 * Если файл поврежден → создать backup и новую память
	 */
	async load(): Promise<void> {
		console.log(
			`📂 [BotMemory.load] Загрузка памяти для бота "${this.botName}"`
		)

		try {
			// Создать директорию data/ если не существует
			await this.ensureDataDirectory()

			// Проверить существование файла
			try {
				await fs.access(this.filePath)
			} catch {
				console.log(
					`⚠️ [BotMemory.load] Файл памяти не найден, создаётся новая память`
				)
				this.memory = this.createDefaultMemory()
				await this.save()
				return
			}

			// Попытка загрузки файла
			const data = await fs.readFile(this.filePath, 'utf-8')
			this.memory = JSON.parse(data)

			console.log(
				`✅ [BotMemory.load] Память успешно загружена (версия: ${this.memory.meta.version})`
			)
		} catch (error) {
			console.error(`❌ [BotMemory.load] Ошибка загрузки памяти:`, error)

			// Создать backup повреждённого файла
			await this.createBackup()

			// Создать новую память
			this.memory = this.createDefaultMemory()
			await this.save()
		}
	}

	/**
	 * Сохранить память в файл
	 */
	async save(): Promise<void> {
		try {
			// Обновить timestamp
			this.memory.meta.lastUpdated = new Date().toISOString()

			// Создать директорию если не существует
			await this.ensureDataDirectory()

			// Сохранить в JSON
			const jsonData = JSON.stringify(this.memory, null, 2)
			await fs.writeFile(this.filePath, jsonData, 'utf-8')

			console.log(`💾 [BotMemory.save] Память успешно сохранена`)
		} catch (error) {
			console.error(`❌ [BotMemory.save] Ошибка сохранения памяти:`, error)
			throw error
		}
	}

	/**
	 * Создать директорию data/ если не существует
	 */
	private async ensureDataDirectory(): Promise<void> {
		try {
			await fs.access(this.dataDir)
		} catch {
			console.log(`📁 [BotMemory] Создаётся директория: ${this.dataDir}`)
			await fs.mkdir(this.dataDir, { recursive: true })
		}
	}

	/**
	 * Создать backup повреждённого файла
	 */
	private async createBackup(): Promise<void> {
		try {
			const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
			const backupPath = path.join(
				this.dataDir,
				`bot_memory_${this.botName}.backup_${timestamp}.json`
			)

			await fs.copyFile(this.filePath, backupPath)
			console.log(`🔄 [BotMemory] Создан backup: ${backupPath}`)
		} catch (error) {
			console.error(`⚠️ [BotMemory] Не удалось создать backup:`, error)
		}
	}

	/**
	 * Создать пустую структуру памяти
	 */
	private createDefaultMemory(): BotMemoryData {
		console.log(
			`🆕 [BotMemory] Создаётся дефолтная память для "${this.botName}"`
		)

		return {
			meta: {
				botName: this.botName,
				createdAt: new Date().toISOString(),
				lastUpdated: new Date().toISOString(),
				version: '1.0.0'
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

	// ========================================================================
	// API для работы с локациями
	// ========================================================================

	/**
	 * Запомнить локацию (сундук, ресурс)
	 * @param type - тип локации ('chest' | 'resource')
	 * @param position - координаты
	 * @param metadata - дополнительные данные
	 */
	rememberLocation(
		type: 'chest' | 'resource' | 'home' | 'spawn',
		position: Vec3,
		metadata?: Record<string, any>
	): void {
		console.log(
			`📍 [BotMemory.rememberLocation] Сохранение локации: ${type} в (${position.x}, ${position.y}, ${position.z})`
		)

		switch (type) {
			case 'chest': {
				const chestLocation: ChestLocation = {
					position,
					type: (metadata?.containerType as ChestLocation['type']) || 'chest',
					contents: metadata?.contents || [],
					lastChecked: new Date().toISOString()
				}
				this.memory.world.knownLocations.chests.push(chestLocation)
				break
			}

			case 'resource': {
				const resourceLocation: ResourceLocation = {
					type: metadata?.resourceType || 'unknown',
					position,
					discovered: new Date().toISOString()
				}
				this.memory.world.knownLocations.resources.push(resourceLocation)
				break
			}

			case 'home': {
				this.memory.world.knownLocations.home = position
				break
			}

			case 'spawn': {
				this.memory.world.knownLocations.spawn = position
				break
			}
		}
	}

	/**
	 * Найти ближайшую известную локацию
	 * @param type - тип локации для поиска
	 * @param currentPosition - текущая позиция
	 * @returns позиция ближайшей локации или null
	 */
	findNearestKnown(
		type: 'chest' | 'resource' | 'home' | 'spawn',
		currentPosition: Vec3,
		filter?: Record<string, any>
	): Vec3 | null {
		console.log(
			`🔍 [BotMemory.findNearestKnown] Поиск ближайшей локации: ${type}`
		)

		let locations: Array<{ position: Vec3 }> = []

		switch (type) {
			case 'chest':
				locations = this.memory.world.knownLocations.chests.filter(loc => {
					if (!filter) return true
					if (filter.containerType && loc.type !== filter.containerType)
						return false
					return true
				})
				break

			case 'resource':
				locations = this.memory.world.knownLocations.resources.filter(loc => {
					if (!filter) return true
					if (filter.resourceType && loc.type !== filter.resourceType)
						return false
					return true
				})
				break

			case 'home':
				if (this.memory.world.knownLocations.home) {
					return this.memory.world.knownLocations.home
				}
				return null

			case 'spawn':
				if (this.memory.world.knownLocations.spawn) {
					return this.memory.world.knownLocations.spawn
				}
				return null
		}

		if (locations.length === 0) {
			console.log(
				`⚠️ [BotMemory.findNearestKnown] Локации типа "${type}" не найдены`
			)
			return null
		}

		// Найти ближайшую (используем non-null assertion т.к. проверили length выше)
		let nearest = locations[0]!
		let minDistance = this.distance(currentPosition, nearest.position)

		for (const loc of locations) {
			const dist = this.distance(currentPosition, loc.position)
			if (dist < minDistance) {
				minDistance = dist
				nearest = loc
			}
		}

		console.log(
			`✅ [BotMemory.findNearestKnown] Найдена локация на расстоянии ${minDistance.toFixed(2)} блоков`
		)
		return nearest.position
	}

	/**
	 * Вычислить расстояние между двумя точками
	 */
	private distance(a: Vec3, b: Vec3): number {
		const dx = a.x - b.x
		const dy = a.y - b.y
		const dz = a.z - b.z
		return Math.sqrt(dx * dx + dy * dy + dz * dz)
	}

	// ========================================================================
	// API для работы с игроками
	// ========================================================================

	/**
	 * Запомнить встреченного игрока
	 * @param username - имя игрока
	 * @param metadata - дополнительные данные
	 */
	rememberPlayer(username: string, metadata?: Partial<PlayerInfo>): void {
		console.log(`👤 [BotMemory.rememberPlayer] Сохранение игрока: ${username}`)

		const existing = this.memory.world.knownPlayers[username]

		if (existing) {
			// Обновить существующего
			existing.lastSeen = new Date().toISOString()
			existing.interactions++
			if (metadata?.friendly !== undefined)
				existing.friendly = metadata.friendly
			if (metadata?.notes) existing.notes.push(...metadata.notes)
		} else {
			// Добавить нового
			this.memory.world.knownPlayers[username] = {
				firstMet: new Date().toISOString(),
				lastSeen: new Date().toISOString(),
				interactions: 1,
				friendly: metadata?.friendly ?? true,
				notes: metadata?.notes || []
			}
		}
	}

	// ========================================================================
	// API для работы с задачами
	// ========================================================================

	/**
	 * Запомнить выполнение задачи
	 * @param taskType - тип задачи (MINING, CRAFTING, etc.)
	 * @param success - успешно или нет
	 * @param duration - длительность в миллисекундах
	 */
	rememberTask(taskType: string, success: boolean, duration: number): void {
		console.log(
			`📋 [BotMemory.rememberTask] Задача ${taskType}: ${success ? 'успех' : 'провал'}, длительность: ${duration}ms`
		)

		const existing = this.memory.experience.tasksCompleted[taskType]

		if (existing) {
			// Обновить статистику
			existing.count++
			const totalSuccess = existing.successRate * (existing.count - 1)
			existing.successRate = (totalSuccess + (success ? 1 : 0)) / existing.count

			const totalTime = existing.averageTime * (existing.count - 1)
			existing.averageTime = (totalTime + duration) / existing.count

			existing.lastCompleted = new Date().toISOString()
		} else {
			// Создать новую запись
			this.memory.experience.tasksCompleted[taskType] = {
				count: 1,
				successRate: success ? 1.0 : 0.0,
				averageTime: duration,
				lastCompleted: new Date().toISOString()
			}
		}
	}

	// ========================================================================
	// API для работы со смертями
	// ========================================================================

	/**
	 * Запомнить смерть
	 * @param cause - причина смерти
	 * @param location - место смерти
	 * @param lesson - извлечённый урок (опционально)
	 */
	rememberDeath(cause: string, location: Vec3, lesson?: string): void {
		console.log(
			`💀 [BotMemory.rememberDeath] Смерть от ${cause} в (${location.x}, ${location.y}, ${location.z})`
		)

		this.memory.experience.deaths.push({
			timestamp: new Date().toISOString(),
			cause,
			location,
			lesson
		})
	}

	// ========================================================================
	// API для работы со статистикой
	// ========================================================================

	/**
	 * Обновить статистику
	 * @param type - тип статистики ('mined' | 'placed' | 'crafted' | 'killed')
	 * @param item - название предмета/моба
	 * @param count - количество (добавляется к существующему)
	 */
	updateStats(
		type: 'mined' | 'placed' | 'crafted' | 'killed',
		item: string,
		count: number
	): void {
		console.log(`📊 [BotMemory.updateStats] ${type}: ${item} +${count}`)

		switch (type) {
			case 'mined':
				this.memory.stats.blocksMined[item] =
					(this.memory.stats.blocksMined[item] || 0) + count
				break

			case 'placed':
				this.memory.stats.blocksPlaced[item] =
					(this.memory.stats.blocksPlaced[item] || 0) + count
				break

			case 'crafted':
				this.memory.stats.itemsCrafted = this.memory.stats.itemsCrafted || {}
				this.memory.stats.itemsCrafted[item] =
					(this.memory.stats.itemsCrafted[item] || 0) + count
				break

			case 'killed':
				this.memory.stats.mobsKilled = this.memory.stats.mobsKilled || {}
				this.memory.stats.mobsKilled[item] =
					(this.memory.stats.mobsKilled[item] || 0) + count
				break
		}
	}

	/**
	 * Обновить пройденное расстояние
	 * @param distance - расстояние в блоках
	 */
	updateDistance(distance: number): void {
		this.memory.stats.distanceTraveled += distance
	}

	/**
	 * Обновить общее время игры
	 * @param playtime - время в миллисекундах
	 */
	updatePlaytime(playtime: number): void {
		this.memory.stats.totalPlaytime += playtime
	}

	// ========================================================================
	// API для работы с целями
	// ========================================================================

	/**
	 * Установить текущую цель
	 */
	setCurrentGoal(goal: CurrentGoal): void {
		console.log(`🎯 [BotMemory.setCurrentGoal] Установлена цель: ${goal.goal}`)
		this.memory.goals.current = goal
	}

	/**
	 * Завершить текущую цель
	 */
	completeCurrentGoal(): void {
		if (!this.memory.goals.current) return

		console.log(
			`✅ [BotMemory.completeCurrentGoal] Завершена цель: ${this.memory.goals.current.goal}`
		)

		const completed: CompletedGoal = {
			goal: this.memory.goals.current.goal,
			completedAt: new Date().toISOString(),
			duration:
				Date.now() - new Date(this.memory.goals.current.startedAt).getTime(),
			tasksCompleted: this.memory.goals.current.currentTaskIndex || 0
		}

		this.memory.goals.completed.push(completed)
		this.memory.goals.current = undefined
	}

	/**
	 * Провалить текущую цель
	 */
	failCurrentGoal(reason: string): void {
		if (!this.memory.goals.current) return

		console.log(
			`❌ [BotMemory.failCurrentGoal] Провалена цель: ${this.memory.goals.current.goal}, причина: ${reason}`
		)

		const failed: FailedGoal = {
			goal: this.memory.goals.current.goal,
			failedAt: new Date().toISOString(),
			reason,
			tasksAttempted: this.memory.goals.current.currentTaskIndex || 0
		}

		this.memory.goals.failed.push(failed)
		this.memory.goals.current = undefined
	}

	// ========================================================================
	// Геттеры
	// ========================================================================

	/**
	 * Получить всю память (readonly)
	 */
	getMemory(): Readonly<BotMemoryData> {
		return this.memory
	}

	/**
	 * Получить известные локации
	 */
	getKnownLocations(): Readonly<KnownLocations> {
		return this.memory.world.knownLocations
	}

	/**
	 * Получить статистику задач
	 */
	getTaskStats(taskType: string): TaskStats | undefined {
		return this.memory.experience.tasksCompleted[taskType]
	}

	/**
	 * Получить общую статистику
	 */
	getStats(): Readonly<BotMemoryData['stats']> {
		return this.memory.stats
	}
}
