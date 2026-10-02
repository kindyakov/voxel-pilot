import {
	inspectNearbyBlocks,
	inspectNearbyEntities
} from '@/ai/runtime/inspect.js'
import { describePlayerInventory } from '@/ai/runtime/window.js'

import type {
	InlineToolExecutionContext,
	InlineToolExecutionResult
} from '../inlineExecutor.js'
import { toBlocksScope } from '../shared.js'

export const executeInspectTool = async (
	name: 'inspect_inventory' | 'inspect_blocks' | 'inspect_entities',
	args: Record<string, unknown>,
	context: InlineToolExecutionContext
): Promise<InlineToolExecutionResult> => {
	switch (name) {
		case 'inspect_inventory': {
			const inventory = describePlayerInventory(context.bot)
			return { ok: true, output: { inventory } }
		}
		case 'inspect_blocks': {
			const scope = toBlocksScope(args.scope)
			const maxDistance =
				typeof args.max_distance === 'number' ? args.max_distance : undefined
			const targetBlockNames = Array.isArray(args.target_block_names)
				? args.target_block_names.map(String)
				: undefined
			const blocks = inspectNearbyBlocks(context.bot, {
				scope,
				targetBlockNames,
				maxDistance
			})

			return {
				ok: true,
				output: {
					scope,
					targetBlockNames: targetBlockNames ?? null,
					maxDistance: maxDistance ?? null,
					blocks
				}
			}
		}
		case 'inspect_entities': {
			const maxDistance =
				typeof args.max_distance === 'number' ? args.max_distance : undefined
			const entities = inspectNearbyEntities(context.bot, {
				maxDistance
			})

			return {
				ok: true,
				output: {
					maxDistance: maxDistance ?? null,
					entities
				}
			}
		}
	}
}
