export class AntiStuck {
	constructor(bot, options = {}) {
		this.bot = bot
		this.options = {
			timeout: options.timeout || 3000, // таймаут застревания (мс)
			minDistance: options.minDistance || 0.5, // минимальная дистанция движения
			maxAttempts: options.maxAttempts || 3, // максимум попыток
			checkInterval: options.checkInterval || 1000, // интервал проверки
			...options
		}

		this.lastPosition = null
		this.lastMovingAt = Date.now()
		this.stuckAttempts = 0
		this.stuckPosition = null
		this.isActive = false
		this.timer = null
		this.onStuckCallback = null
		this.onRecoveredCallback = null
	}

	start(onStuck, onRecovered) {
		if (this.isActive) return

		this.isActive = true
		this.onStuckCallback = onStuck
		this.onRecoveredCallback = onRecovered
		this.lastPosition = this.bot.entity.position.clone()
		this.lastMovingAt = Date.now()
		this.stuckAttempts = 0

		this.timer = setInterval(() => this.check(), this.options.checkInterval)
	}

	stop() {
		if (!this.isActive) return

		this.isActive = false
		clearInterval(this.timer)
		this.timer = null
		this.reset()
	}

	check() {
		if (!this.isActive) return

		const currentPos = this.bot.entity.position
		const now = Date.now()

		// Проверка движения
		if (this.hasReallyMoved(currentPos)) {
			this.updateMovement(currentPos, now)
			return
		}

		// Проверка застревания
		if (this.isStuck(now)) {
			this.handleStuck(currentPos)
		}
	}

	hasReallyMoved(currentPos) {
		if (!this.lastPosition) return true
		return currentPos.distanceTo(this.lastPosition) > this.options.minDistance
	}

	updateMovement(currentPos, now) {
		this.lastPosition = currentPos.clone()
		this.lastMovingAt = now

		// Если восстановился после застревания
		if (this.stuckAttempts > 0) {
			this.stuckAttempts = 0
			this.stuckPosition = null
			this.onRecoveredCallback?.()
		}
	}

	isStuck(now) {
		return now - this.lastMovingAt > this.options.timeout
	}

	handleStuck(currentPos) {
		// Проверяем застревание в том же месте
		if (this.stuckPosition && currentPos.distanceTo(this.stuckPosition) < 1) {
			this.stuckAttempts++
		} else {
			this.stuckAttempts = 1
			this.stuckPosition = currentPos.clone()
		}

		// Вызываем колбэк с информацией о застревании
		const stuckInfo = {
			attempts: this.stuckAttempts,
			maxAttempts: this.options.maxAttempts,
			position: currentPos.clone(),
			duration: Date.now() - this.lastMovingAt
		}

		this.onStuckCallback?.(stuckInfo)
	}

	reset() {
		this.lastPosition = null
		this.lastMovingAt = Date.now()
		this.stuckAttempts = 0
		this.stuckPosition = null
	}

	// Готовые стратегии восстановления
	static recoveryStrategies = {
		// Прыжок на месте
		jump: bot => {
			bot.setControlState('jump', true)
			setTimeout(() => bot.setControlState('jump', false), 500)
		},

		// Отход назад
		backUp: bot => {
			bot.setControlState('back', true)
			setTimeout(() => bot.setControlState('back', false), 1000)
		},

		// Попытка копать блок впереди
		dig: async bot => {
			const block = bot.blockAtCursor(3)
			if (block && bot.canDigBlock(block)) {
				try {
					await bot.dig(block)
				} catch (error) {
					// Игнорируем ошибки копания
				}
			}
		},

		// Сброс цели pathfinder
		resetPath: (bot, goal) => {
			bot.pathfinder.setGoal(null)
			setTimeout(() => bot.pathfinder.setGoal(goal, true), 1000)
		}
	}
}
