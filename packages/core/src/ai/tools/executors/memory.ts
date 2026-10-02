import type {
	InlineToolExecutionContext,
	InlineToolExecutionResult
} from '../inlineExecutor.js'
import {
	getMemory,
	toJsonRecord,
	toMemoryEntryType,
	tryToPosition
} from '../shared.js'

export const executeMemoryTool = async (
	name: 'memory_save' | 'memory_read' | 'memory_update_data' | 'memory_delete',
	args: Record<string, unknown>,
	context: InlineToolExecutionContext
): Promise<InlineToolExecutionResult> => {
	const memory = getMemory(context.bot)

	switch (name) {
		case 'memory_save': {
			const entryType = toMemoryEntryType(args.type)
			if (!entryType) {
				return {
					ok: false,
					output: { reason: 'memory_save requires a valid entry type' }
				}
			}

			const position = tryToPosition(args.position)
			if (!position) {
				return {
					ok: false,
					output: { reason: 'memory_save requires a finite position' }
				}
			}

			const entry = memory.saveEntry({
				type: entryType,
				position,
				tags: Array.isArray(args.tags) ? args.tags.map(String) : [],
				description: String(args.description ?? ''),
				data: toJsonRecord(args.data)
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
				toJsonRecord(args.data)
			)
			return { ok: Boolean(entry), output: { updated: Boolean(entry), entry } }
		}
		case 'memory_delete': {
			const deleted = memory.deleteEntry({
				id: typeof args.id === 'string' ? args.id : undefined,
				position: tryToPosition(args.position) ?? undefined,
				type: toMemoryEntryType(args.type) ?? undefined
			})
			return { ok: deleted, output: { deleted } }
		}
	}
}
