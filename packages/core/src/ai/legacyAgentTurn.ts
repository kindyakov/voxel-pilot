import { defaultRequestDumpDirectory } from '../runtimePaths.js'
import type { AgentTurnInput, AgentTurnResult } from './contracts/agentTurn.js'
import { createAgentTurnRunner } from './loop/runAgentTurn.js'

/** @deprecated Compatibility for the old lifecycle; explicit runtimes supply a runner. */
export async function runAgentTurn(
	input: AgentTurnInput
): Promise<AgentTurnResult> {
	const [{ default: config }, { default: logger }] = await Promise.all([
		import('../config/config.js'),
		import('../config/logger.js')
	])
	const provider = config.ai.provider
	if (
		provider !== 'openai' &&
		provider !== 'routerai' &&
		provider !== 'openrouter' &&
		provider !== 'openai_compatible' &&
		provider !== 'local' &&
		provider !== 'disabled'
	) {
		throw new Error('Unsupported legacy AI provider')
	}
	return createAgentTurnRunner({
		ai: { ...config.ai, provider },
		logger,
		debugDump: {
			enabled: process.env.AI_DEBUG_DUMP === '1',
			directory: defaultRequestDumpDirectory
		}
	})(input)
}
