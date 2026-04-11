import type { MemoryEntryType } from '@/core/memory/types.js'

import type {
	InlineToolExecutionContext,
	InlineToolExecutionResult
} from '../inlineExecutor.js'
import { getMemory, toPosition } from '../shared.js'

export const executeMemoryTool = async (
	name: 'memory_save' | 'memory_read' | 'memory_update_data' | 'memory_delete',
	args: Record<string, unknown>,
	context: InlineToolExecutionContext
): Promise<InlineToolExecutionResult> => {
	const memory = getMemory(context.bot)

	switch (name) {
		case 'memory_save': {
			const entry = memory.saveEntry({
				type: String(args.type) as MemoryEntryType,
				position: toPosition(args.position as Record<string, unknown>),
				tags: Array.isArray(args.tags) ? args.tags.map(String) : [],
				description: String(args.description ?? ''),
				data:
					args.data &&
					typeof args.data === 'object' &&
					!Array.isArray(args.data)
						? (args.data as Record<string, unknown>)
						: {}
			})

			return { ok: true, output: { entry } }
		}
		case 'memory_read': {
			const entries = memory.readEntries({
				queryTags: Array.isArray(args.query_tags)
					? args.query_tags.map(String)
					: [],
				origin: context.bot.entity?.position
					? {
							x: context.bot.entity.position.x,
							y: context.bot.entity.position.y,
							z: context.bot.entity.position.z
						}
					: undefined,
				maxDistance: Number(args.max_distance ?? 0)
			})
			return { ok: true, output: { entries } }
		}
		case 'memory_update_data': {
			const entry = memory.updateEntryData(
				String(args.id ?? ''),
				args.data && typeof args.data === 'object' && !Array.isArray(args.data)
					? (args.data as Record<string, unknown>)
					: {}
			)
			return { ok: Boolean(entry), output: { updated: Boolean(entry), entry } }
		}
		case 'memory_delete': {
			const deleted = memory.deleteEntry({
				id: typeof args.id === 'string' ? args.id : undefined,
				position:
					args.position && typeof args.position === 'object'
						? toPosition(args.position as Record<string, unknown>)
						: undefined,
				type:
					typeof args.type === 'string'
						? (args.type as MemoryEntryType)
						: undefined
			})
			return { ok: deleted, output: { deleted } }
		}
	}
}
