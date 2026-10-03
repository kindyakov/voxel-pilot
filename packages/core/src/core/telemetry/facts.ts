import type { BotSnapshot, Measurement } from '@voxel-pilot/contracts'

export type RuntimeFacts = Pick<
	BotSnapshot,
	'health' | 'maxHealth' | 'food' | 'position' | 'harness'
>

const unknown = Object.freeze({ value: null, updatedAt: null, stale: false })
export const unknownFacts: RuntimeFacts = Object.freeze({
	health: unknown,
	maxHealth: unknown,
	food: unknown,
	position: unknown,
	harness: unknown
})

export function measured<T>(value: T): Measurement<T> {
	return Object.freeze({ value, updatedAt: Date.now(), stale: false })
}

export function staleFacts(facts: RuntimeFacts): RuntimeFacts {
	const stale = <T>(value: Measurement<T>): Measurement<T> =>
		value.value === null || value.stale
			? value
			: Object.freeze({ ...value, stale: true })
	return {
		health: stale(facts.health),
		maxHealth: stale(facts.maxHealth),
		food: stale(facts.food),
		position: stale(facts.position),
		harness: stale(facts.harness)
	}
}

export function deliver<T>(listener: (value: T) => void, value: T): void {
	try {
		void Promise.resolve(listener(value)).catch(() => {})
	} catch {}
}
