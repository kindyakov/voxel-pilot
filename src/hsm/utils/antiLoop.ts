interface AntiLoopGuardConfig {
	maxTransitionsPerSecond: number
	emergencyStopAfter: number
	windowMs: number
}

interface Update {
	timestamp: number
	signature: string
}

interface AntiLoopGuardStats {
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
	private lastSignature: string | null = null

	constructor(options: AntiLoopGuardConfig) {
		this.maxUpdatesPerSecond = options.maxTransitionsPerSecond
		this.windowMs = options.windowMs
	}

	recordUpdate(signature: string = 'update'): boolean {
		if (this.loopDetected) {
			return false
		}

		if (this.lastSignature === signature) {
			return true
		}

		this.lastSignature = signature

		const now = Date.now()
		const update: Update = {
			timestamp: now,
			signature
		}

		this.updateHistory.push(update)
		this.totalUpdates++

		this.updateHistory = this.updateHistory.filter(
			u => now - u.timestamp < this.windowMs
		)

		if (this.updateHistory.length > this.maxUpdatesPerSecond) {
			this.reportLoop(
				`Too many updates: ${this.updateHistory.length} updates in ${this.windowMs}ms (limit: ${this.maxUpdatesPerSecond})`
			)
			return false
		}

		return true
	}

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
			console.error(`  ${i + 1}. [${time}] ${u.signature}`)
		})
		console.error('═'.repeat(60))
	}

	reset(): void {
		this.updateHistory = []
		this.totalUpdates = 0
		this.loopDetected = false
		this.lastSignature = null
	}

	getStats(): AntiLoopGuardStats {
		return {
			updatesInLastSecond: this.updateHistory.length,
			totalUpdates: this.totalUpdates,
			loopDetected: this.loopDetected,
			recentUpdates: this.updateHistory.slice(-10)
		}
	}
}
