import defaultConfig, { type Config as ConfigInstance } from '@/config/config.js'

import type { AgentModelClient } from '../contracts/agentClient.js'
import { isAiPilotDisabled } from '../pilotAvailability.js'
import { OpenAICompatibleChatClient } from './chatClient.js'
import { NoOpAgentClient } from './noOpClient.js'
import { OpenAIResponsesClient } from './responsesClient.js'

export const createAgentClient = (
	config: Pick<ConfigInstance, 'ai'> = defaultConfig
): AgentModelClient => {
	const provider = config.ai.provider
	if (isAiPilotDisabled(provider)) {
		return new NoOpAgentClient(provider)
	}

	switch (provider) {
		case 'routerai':
		case 'openrouter':
		case 'openai_compatible':
			return new OpenAICompatibleChatClient({
				apiKey: config.ai.apiKey,
				model: config.ai.model,
				timeoutMs: config.ai.timeout,
				maxOutputTokens: config.ai.maxTokens,
				baseUrl: config.ai.baseUrl
			})
		default:
			return new OpenAIResponsesClient({
				apiKey: config.ai.apiKey,
				model: config.ai.model,
				timeoutMs: config.ai.timeout,
				maxOutputTokens: config.ai.maxTokens,
				baseUrl: config.ai.baseUrl
			})
	}
}
