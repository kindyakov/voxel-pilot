import type { AIConfig } from '@/config/runtimeConfig.js'
import type { RuntimeLogger } from '@/config/runtimeLogger.js'

import type { AgentModelClient } from '../contracts/agentClient.js'
import { isAiPilotDisabled } from '../pilotAvailability.js'
import { OpenAICompatibleChatClient } from './chatClient.js'
import { NoOpAgentClient } from './noOpClient.js'
import type { RequestDebugDumpOptions } from './requestDebugDump.js'
import { OpenAIResponsesClient } from './responsesClient.js'

export interface AgentClientDependencies {
	readonly logger: RuntimeLogger
	readonly debugDump: RequestDebugDumpOptions
}

export const createAgentClient = (
	ai: AIConfig,
	dependencies: AgentClientDependencies
): AgentModelClient => {
	const provider = ai.provider
	if (isAiPilotDisabled(provider)) {
		return new NoOpAgentClient(provider)
	}

	switch (provider) {
		case 'routerai':
		case 'openrouter':
		case 'openai_compatible':
			return new OpenAICompatibleChatClient({
				apiKey: ai.apiKey,
				model: ai.model,
				timeoutMs: ai.timeout,
				maxOutputTokens: ai.maxTokens,
				baseUrl: ai.baseUrl,
				...dependencies
			})
		default:
			return new OpenAIResponsesClient({
				apiKey: ai.apiKey,
				model: ai.model,
				timeoutMs: ai.timeout,
				maxOutputTokens: ai.maxTokens,
				baseUrl: ai.baseUrl,
				...dependencies
			})
	}
}
