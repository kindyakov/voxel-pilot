import type { Bot } from '@/types/index.js'
import { Vec3 } from 'vec3'

/** Unknown blocks cannot prove cover; the full eye-to-eye segment must be loaded. */
export const isCoveredFrom = (bot: Bot, position: Vec3, source: Vec3) => {
	const from = position.offset(0, bot.entity.height * 0.9, 0)
	const to = source.offset(0, 1, 0)
	const length = from.distanceTo(to)
	if (!Number.isFinite(length) || length === 0) return false
	const direction = to.minus(from).normalize()
	let blocked = false
	for (let step = 0.25; step < length; step += 0.25) {
		const block = bot.blockAt(from.plus(direction.scaled(step)))
		if (!block) return false
		if (block.boundingBox !== 'empty' && !block.transparent && block.material)
			blocked = true
	}
	return blocked
}

/** Bounded local geometry candidates; EscapeRuntime still proves a walkable route. */
export const coverCandidates = (bot: Bot, source: Vec3, distance: number) => {
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
				isCoveredFrom(bot, candidate, source)
			)
				candidates.push(candidate)
		}
	}
	return candidates.sort((a, b) => origin.distanceTo(a) - origin.distanceTo(b))
}
