import type { Vec3 } from '@/types/index.js'

export type ProgressAnchor = {
	x: number
	z: number
	remaining: number
	at: number
}

export const observeProgress = (
	anchor: ProgressAnchor | null,
	position: Vec3,
	remaining: number,
	now: number,
	timeoutMs: number,
	minimumDistance: number
) => {
	if (
		!anchor ||
		(Math.hypot(position.x - anchor.x, position.z - anchor.z) >=
			minimumDistance &&
			anchor.remaining - remaining >= minimumDistance)
	)
		return {
			anchor: { x: position.x, z: position.z, remaining, at: now },
			progressing: true
		}
	return { anchor, progressing: now - anchor.at < timeoutMs }
}

/** Progress requires horizontal displacement AND improvement toward the current goal. */
export class MovementProgress {
	private anchor: ProgressAnchor | null = null
	constructor(
		private readonly timeoutMs: number,
		private readonly minimumDistance: number
	) {}
	reset() {
		this.anchor = null
	}
	observe(position: Vec3, remaining: number, now: number): boolean {
		const result = observeProgress(
			this.anchor,
			position,
			remaining,
			now,
			this.timeoutMs,
			this.minimumDistance
		)
		this.anchor = result.anchor
		return result.progressing
	}
}
