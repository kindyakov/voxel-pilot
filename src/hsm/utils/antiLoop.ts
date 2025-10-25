export interface AntiLoopGuardConfig {
	maxTransitionsPerSecond: number
	emergencyStopAfter: number
	windowMs: number
}

export interface Update {
	timestamp: number
}

export interface AntiLoopGuardStats {
	updatesInLastSecond: number
	totalUpdates: number
	loopDetected: boolean
	recentUpdates: Update[]
}

export class AntiLoopGuard {
	private maxUpdatesPerSecond: number
	private windowMs: number
	private updateHistory: Update[] = []
	private totalUpdates: number = 0
	private loopDetected: boolean = false

	constructor(options: AntiLoopGuardConfig) {
		this.maxUpdatesPerSecond = options.maxTransitionsPerSecond
		this.windowMs = options.windowMs
	}

	/**
	 * Записывает факт обновления машины состояний и проверяет на зацикливание
	 * @returns {boolean} true если обновление безопасно, false если обнаружено зацикливание
	 */
	recordUpdate(): boolean {
		if (this.loopDetected) {
			return false
		}

		const now = Date.now()
		const update: Update = {
			timestamp: now
		}

		this.updateHistory.push(update)
		this.totalUpdates++

		// Очищаем старые записи (старше 1 секунды)
		this.updateHistory = this.updateHistory.filter(
			u => now - u.timestamp < this.windowMs
		)

		// ЕДИНСТВЕННАЯ ПРОВЕРКА: слишком много обновлений за секунду → обнаружено зацикливание
		if (this.updateHistory.length > this.maxUpdatesPerSecond) {
			this.reportLoop(
				`Too many updates: ${this.updateHistory.length} updates in ${this.windowMs}ms (limit: ${this.maxUpdatesPerSecond})`
			)
			return false
		}

		return true
	}

	/**
	 * Сообщает об обнаружении зацикливания
	 */
	reportLoop(reason: string): void {
		this.loopDetected = true
		console.error('')
		console.error('═'.repeat(60))
		console.error('🔁 LOOP DETECTED - AntiLoopGuard 🔁')
		console.error('═'.repeat(60))
		console.error(`Reason: ${reason}`)
		console.error(`Total updates: ${this.totalUpdates}`)
		console.error('')
		console.error('Last 20 updates:')
		this.updateHistory.slice(-20).forEach((u, i) => {
			const time = new Date(u.timestamp).toISOString().split('T')[1]
			console.error(`  ${i + 1}. [${time}] Update`)
		})
		console.error('═'.repeat(60))
	}

	/**
	 * Сброс счетчиков
	 */
	reset(): void {
		this.updateHistory = []
		this.totalUpdates = 0
		this.loopDetected = false
	}

	/**
	 * Получить статистику
	 */
	getStats(): AntiLoopGuardStats {
		return {
			updatesInLastSecond: this.updateHistory.length,
			totalUpdates: this.totalUpdates,
			loopDetected: this.loopDetected,
			recentUpdates: this.updateHistory.slice(-10)
		}
	}
}
