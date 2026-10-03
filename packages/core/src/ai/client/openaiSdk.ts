import OpenAI from 'openai'

import type { AgentClientOptions } from '../contracts/agentClient.js'

/** The two production request adapters share explicit credential/tenant isolation. */
export function createOpenAISdk(
	options: Pick<AgentClientOptions, 'apiKey' | 'baseUrl'>
): OpenAI {
	if (!options.apiKey?.trim())
		throw new Error('Explicit AI API key is required')
	return new OpenAI({
		apiKey: options.apiKey,
		baseURL: options.baseUrl ?? 'https://api.openai.com/v1',
		organization: null,
		project: null,
		adminAPIKey: null,
		webhookSecret: null,
		defaultHeaders: {
			Authorization: `Bearer ${options.apiKey}`,
			'OpenAI-Organization': null,
			'OpenAI-Project': null
		},
		logLevel: 'off'
	})
}
