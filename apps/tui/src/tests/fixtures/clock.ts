import type { DeadlineClock } from '../../app/clock.js'

export class ManualClock implements DeadlineClock {
	private time = 10000
	private tasks = new Set<{ at: number; callback: () => void }>()
	now = () => this.time
	schedule(callback: () => void, milliseconds: number) {
		const task = { at: this.time + milliseconds, callback }
		this.tasks.add(task)
		return () => {
			this.tasks.delete(task)
		}
	}
	advance(milliseconds: number) {
		this.time += milliseconds
		for (const task of [...this.tasks]) {
			if (task.at <= this.time && this.tasks.delete(task)) task.callback()
		}
	}
	get pending() {
		return this.tasks.size
	}
}
