import type { Bot } from '@/types/index.js'
import { Vec3 } from 'vec3'

const intersectsShape = (
	from: Vec3,
	to: Vec3,
	origin: Vec3,
	shape: readonly number[]
) => {
	let entry = 0
	let exit = 1
	for (const [axis, index] of [
		['x', 0],
		['y', 1],
		['z', 2]
	] as const) {
		const delta = to[axis] - from[axis]
		const low = shape[index]
		const high = shape[index + 3]
		if (
			low === undefined ||
			high === undefined ||
			!Number.isFinite(low) ||
			!Number.isFinite(high)
		)
			return false
		const minimum = origin[axis] + low
		const maximum = origin[axis] + high
		if (delta === 0) {
			if (from[axis] < minimum || from[axis] > maximum) return false
			continue
		}
		const near = (minimum - from[axis]) / delta
		const far = (maximum - from[axis]) / delta
		entry = Math.max(entry, Math.min(near, far))
		exit = Math.min(exit, Math.max(near, far))
		if (entry >= exit) return false
	}
	return exit > 0 && entry < 1
}

/** Traverse every crossed voxel and its actual collision shapes; unloaded cells cannot prove cover. */
export const traceLoadedSight = (
	bot: Bot,
	from: Vec3,
	to: Vec3
): 'clear' | 'blocked' | 'unknown' => {
	const length = from.distanceTo(to)
	if (!Number.isFinite(length)) return 'unknown'
	if (length === 0) return 'clear'
	const direction = to.minus(from)
	const voxel = from.floored()
	const end = to.floored()
	const steps =
		Math.abs(end.x - voxel.x) +
		Math.abs(end.y - voxel.y) +
		Math.abs(end.z - voxel.z) +
		1
	const axes = ['x', 'y', 'z'] as const
	const crossing = (axis: (typeof axes)[number]) =>
		direction[axis] === 0
			? Infinity
			: ((direction[axis] > 0 ? voxel[axis] + 1 : voxel[axis]) - from[axis]) /
				direction[axis]
	const crossings = { x: crossing('x'), y: crossing('y'), z: crossing('z') }
	let blocked = false
	for (let step = 0; step < steps; step++) {
		const block = bot.blockAt(voxel)
		if (!block) return 'unknown'
		if (block.shapes.some(shape => intersectsShape(from, to, voxel, shape)))
			blocked = true
		if (voxel.equals(end)) break
		const next = Math.min(crossings.x, crossings.y, crossings.z)
		for (const axis of axes) {
			if (crossings[axis] !== next) continue
			voxel[axis] += Math.sign(direction[axis])
			crossings[axis] += Math.abs(1 / direction[axis])
		}
	}
	return blocked ? 'blocked' : 'clear'
}

export const isCoveredFrom = (
	bot: Bot,
	position: Vec3,
	source: Vec3,
	sourceHeight = 1.8
) =>
	traceLoadedSight(
		bot,
		position.offset(0, bot.entity.height * 0.9, 0),
		source.offset(0, sourceHeight * 0.9, 0)
	) === 'blocked'

/** Bounded local geometry candidates; EscapeRuntime still proves a walkable route. */
export const coverCandidates = (
	bot: Bot,
	source: Vec3,
	distance: number,
	sourceHeight = 1.8
) => {
	const origin = bot.entity.position
	const candidates: Vec3[] = []
	for (const radius of [3, 6, 10, distance]) {
		for (let index = 0; index < 16; index++) {
			const angle = (index * Math.PI) / 8
			const candidate = origin
				.offset(Math.cos(angle) * radius, 0, Math.sin(angle) * radius)
				.floored()
				.offset(0.5, 0, 0.5)
			const feet = bot.blockAt(candidate)
			const head = bot.blockAt(candidate.offset(0, 1, 0))
			const floor = bot.blockAt(candidate.offset(0, -1, 0))
			if (
				feet?.boundingBox === 'empty' &&
				head?.boundingBox === 'empty' &&
				floor?.boundingBox === 'block' &&
				isCoveredFrom(bot, candidate, source, sourceHeight)
			)
				candidates.push(candidate)
		}
	}
	return candidates.sort((a, b) => origin.distanceTo(a) - origin.distanceTo(b))
}
