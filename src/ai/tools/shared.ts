import type { InspectBlocksScope } from '@/ai/runtime/inspect.js'
import { Vec3 as Vec3Class } from 'vec3'

import type { Bot } from '@/types'

import type { MemoryEntryType, MemoryPosition } from '@/core/memory/types.js'

export const positionSchema = {
	type: 'object',
	additionalProperties: false,
	properties: {
		x: { type: 'number' },
		y: { type: 'number' },
		z: { type: 'number' }
	},
	required: ['x', 'y', 'z']
} satisfies Record<string, unknown>

export const vectorSchema = {
	type: 'object',
	additionalProperties: false,
	properties: {
		x: { type: 'number' },
		y: { type: 'number' },
		z: { type: 'number' }
	},
	required: ['x', 'y', 'z']
} satisfies Record<string, unknown>

export const getMemory = (bot: Bot) => bot.memory as any

export const toPosition = (value: Record<string, unknown>): MemoryPosition => ({
	x: Number(value.x ?? 0),
	y: Number(value.y ?? 0),
	z: Number(value.z ?? 0)
})

export const isRecord = (value: unknown): value is Record<string, unknown> =>
	Boolean(value) && typeof value === 'object' && !Array.isArray(value)

export const tryToPosition = (value: unknown): MemoryPosition | null => {
	if (!isRecord(value)) {
		return null
	}

	const x = Number(value.x)
	const y = Number(value.y)
	const z = Number(value.z)
	if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
		return null
	}

	return {
		x,
		y,
		z
	}
}

export const toVec3 = (position: MemoryPosition) =>
	new Vec3Class(position.x, position.y, position.z)

export const positionsEqual = (
	left: MemoryPosition | null | undefined,
	right: MemoryPosition | null | undefined
): boolean =>
	Boolean(
		left &&
		right &&
		left.x === right.x &&
		left.y === right.y &&
		left.z === right.z
	)

export const toBlocksScope = (value: unknown): InspectBlocksScope => {
	if (value === 'interactables' || value === 'resources' || value === 'all') {
		return value
	}

	return 'all'
}

export type { MemoryEntryType, MemoryPosition }
