import defaultConfig, { type Config as ConfigInstance } from '@/config/config'

import type { AgentModelClient } from '../contracts/agentClient.js'
import { OpenAICompatibleChatClient } from './chatClient.js'
import { OpenAIResponsesClient } from './responsesClient.js'

export const createAgentClient = (
	config: Pick<ConfigInstance, 'ai'> = defaultConfig
): AgentModelClient => {
	switch (config.ai.provider) {
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
