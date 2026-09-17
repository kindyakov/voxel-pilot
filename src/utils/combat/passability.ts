import type { Block } from '@/types/index.js'

/** Doors and gates change collision geometry without changing their block type. */
export const hasPassabilityChanged = (
	before: Block | null,
	after: Block | null
) =>
	Boolean(
		after &&
		(!before ||
			before.type !== after.type ||
			JSON.stringify(before.shapes) !== JSON.stringify(after.shapes))
	)
