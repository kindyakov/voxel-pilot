import { getWindowRuntime } from '@/ai/runtime/window.js'

import type {
	InlineToolExecutionContext,
	InlineToolExecutionResult
} from '../inlineExecutor.js'
import { tryToPosition } from '../shared.js'

export const executeWindowTool = async (
	args: Record<string, unknown>,
	context: InlineToolExecutionContext
): Promise<InlineToolExecutionResult> => {
	const position = tryToPosition(args.position)
	if (args.position !== undefined && !position)
		return {
			ok: false,
			output: {
				reason:
					'inspect_window requires a finite position {x, y, z} when supplied'
			}
		}
	const windows = context.windows ?? getWindowRuntime(context.bot)
	try {
		return { ok: true, output: await windows.inspect(position, context.signal) }
	} catch (error) {
		context.signal?.throwIfAborted()
		return {
			ok: false,
			output: { reason: error instanceof Error ? error.message : String(error) }
		}
	}
}
