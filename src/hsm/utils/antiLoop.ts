export interface AntiLoopGuardConfig {
	maxTransitionsPerSecond: number
	emergencyStopAfter: number
	windowMs: number
}

export interface Transition {
	from: string
	to: string
	timestamp: number
}

export interface AntiLoopGuardStats {
	transitionsInLastSecond: number
	totalTransitions: number
	emergencyStopped: boolean
	recentTransitions: Transition[]
}

export class AntiLoopGuard {
	private maxTransitionsPerSecond: number
	private emergencyStopAfter: number
	private windowMs: number
	private transitionHistory: Transition[] = []
	private totalTransitions: number = 0
	private emergencyStopped: boolean = false

	constructor(options: AntiLoopGuardConfig) {
		this.maxTransitionsPerSecond = options.maxTransitionsPerSecond
		this.emergencyStopAfter = options.emergencyStopAfter
		this.windowMs = options.windowMs
	}

	/**
	 * Записывает переход и проверяет на зацикливание
	 * @returns {boolean} true если переход безопасен, false если нужно остановить
	 */
	recordTransition(fromState: string, toState: string): boolean {
		if (this.emergencyStopped) {
			return false
		}

		const now = Date.now()
		const transition: Transition = {
			from: fromState,
			to: toState,
			timestamp: now
		}

		this.transitionHistory.push(transition)
		this.totalTransitions++

		// Очищаем старые записи (старше 1 секунды)
		this.transitionHistory = this.transitionHistory.filter(
			t => now - t.timestamp < this.windowMs
		)

		// Проверка 1: Слишком много переходов за секунду
		if (this.transitionHistory.length > this.maxTransitionsPerSecond) {
			console.warn(
				`⚠️ WARNING: ${this.transitionHistory.length} transitions in ${this.windowMs}ms`
			)
			console.warn(
				'Recent transitions:',
				this.transitionHistory.slice(-5).map(t => `${t.from} → ${t.to}`)
			)

			// Если переходов в 2 раза больше лимита - останавливаем
			if (this.transitionHistory.length > this.maxTransitionsPerSecond * 2) {
				this.emergencyStop('Too many transitions per second')
				return false
			}
		}

		// Проверка 2: Общее количество переходов достигло лимита
		if (this.totalTransitions >= this.emergencyStopAfter) {
			this.emergencyStop('Total transition limit reached')
			return false
		}

		// Проверка 3: Обнаружение паттерна A→B→A→B (пинг-понг)
		if (this.detectPingPong()) {
			this.emergencyStop('Ping-pong loop detected')
			return false
		}

		return true
	}

	/**
	 * Обнаруживает паттерн A→B→A→B (пинг-понг между двумя состояниями)
	 */
	detectPingPong(): boolean {
		const recent = this.transitionHistory.slice(-6)
		if (recent.length < 4) return false

		// Проверяем последние 4 перехода на паттерн A→B→A→B
		const pattern = recent.slice(-4)
		const isPingPong =
			pattern[0]?.from === pattern[2]?.from &&
			pattern[0]?.to === pattern[2]?.to &&
			pattern[1]?.from === pattern[3]?.from &&
			pattern[1]?.to === pattern[3]?.to &&
			pattern[0]?.from === pattern[1]?.to &&
			pattern[0]?.to === pattern[1]?.from

		if (isPingPong) {
			console.error(
				'🔁 Ping-pong detected:',
				pattern.map(t => `${t.from} → ${t.to}`).join(' | ')
			)
		}

		return isPingPong
	}

	/**
	 * Экстренная остановка машины
	 */
	emergencyStop(reason: string): void {
		this.emergencyStopped = true
		console.error('')
		console.error('═'.repeat(60))
		console.error('🚨 EMERGENCY STOP ACTIVATED 🚨')
		console.error('═'.repeat(60))
		console.error(`Reason: ${reason}`)
		console.error(`Total transitions: ${this.totalTransitions}`)
		console.error('')
		console.error('Last 20 transitions:')
		this.transitionHistory.slice(-20).forEach((t, i) => {
			const time = new Date(t.timestamp).toISOString().split('T')[1]
			console.error(`  ${i + 1}. [${time}] ${t.from} → ${t.to}`)
		})
		console.error('═'.repeat(60))
	}

	/**
	 * Сброс счетчиков
	 */
	reset(): void {
		this.transitionHistory = []
		this.totalTransitions = 0
		this.emergencyStopped = false
	}

	/**
	 * Получить статистику
	 */
	getStats(): AntiLoopGuardStats {
		return {
			transitionsInLastSecond: this.transitionHistory.length,
			totalTransitions: this.totalTransitions,
			emergencyStopped: this.emergencyStopped,
			recentTransitions: this.transitionHistory.slice(-10)
		}
	}
}
