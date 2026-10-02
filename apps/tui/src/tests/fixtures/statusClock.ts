import type { StatusClock } from '../../features/status/index.js'

export class ManualStatusClock implements StatusClock {
	private time: number
	private tasks = new Set<{ at: number; callback: () => void }>()
	readonly delays: number[] = []
	constructor(now = 10000) {
		this.time = now
	}
	now = () => this.time
	schedule(callback: () => void, milliseconds: number) {
		this.delays.push(milliseconds)
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
