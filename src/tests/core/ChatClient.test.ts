import assert from 'node:assert/strict'
import test from 'node:test'

import {
	OpenAICompatibleChatClient,
	type ParsedToolCall,
	createAgentClient
} from '../../ai/client.js'
import { Config } from '../../config/config.js'

test('OpenAICompatibleChatClient maps chat completion tool calls into compact tool calls', async () => {
	const calls: any[] = []
	const client = new OpenAICompatibleChatClient({
		apiKey: 'router-key',
		model: 'z-ai/glm-4.7-flash',
		timeoutMs: 5000,
		client: {
			chat: {
				completions: {
					create: async (payload: unknown) => {
						calls.push(payload)
						return {
							id: 'chatcmpl_1',
							choices: [
								{
									message: {
										content: 'Move to the workbench',
										tool_calls: [
											{
												id: 'call_1',
												type: 'function',
												function: {
													name: 'navigate_to',
													arguments:
														'{"position":{"x":12,"y":64,"z":-4},"range":2}'
												}
											}
										]
									}
								}
							]
						}
					}
				}
			}
		} as any
	})

	const response = await client.createResponse({
		instructions: 'Use tools only',
		input: 'Goal: use the workbench',
		tools: []
	})

	assert.equal(calls.length, 1)
	assert.equal(response.id, 'chatcmpl_1')
	assert.equal(response.outputText, 'Move to the workbench')
	assert.deepEqual(response.toolCalls satisfies ParsedToolCall[], [
		{
			callId: 'call_1',
			name: 'navigate_to',
			arguments: {
				position: { x: 12, y: 64, z: -4 },
				range: 2
			}
		}
	])
})

test('OpenAICompatibleChatClient tolerates missing choices without throwing', async () => {
	const client = new OpenAICompatibleChatClient({
		apiKey: 'router-key',
		model: 'qwen/qwen3.5-flash-02-23',
		timeoutMs: 5000,
		client: {
			chat: {
				completions: {
					create: async () =>
						({
							id: 'chatcmpl_empty'
						}) as any
				}
			}
		} as any
	})

	const response = await client.createResponse({
		instructions: 'Use tools only',
		input: 'Goal: inspect inventory',
		tools: []
	})

	assert.equal(response.id, 'chatcmpl_empty')
	assert.equal(response.outputText, '')
	assert.deepEqual(response.toolCalls, [])
})

test('createAgentClient selects chat completions client for routerai provider', () => {
	const previousEnv = {
		AI_PROVIDER: process.env.AI_PROVIDER,
		AI_BASE_URL: process.env.AI_BASE_URL,
		AI_API_KEY: process.env.AI_API_KEY,
		AI_MODEL: process.env.AI_MODEL,
		AI_TIMEOUT_MS: process.env.AI_TIMEOUT_MS,
		AI_MAX_TOKENS: process.env.AI_MAX_TOKENS
	}

	process.env.AI_PROVIDER = 'routerai'
	process.env.AI_BASE_URL = 'https://routerai.ru/api/v1'
	process.env.AI_API_KEY = 'router-key'
	process.env.AI_MODEL = 'z-ai/glm-4.7-flash'
	process.env.AI_TIMEOUT_MS = '15000'
	process.env.AI_MAX_TOKENS = '800'

	try {
		const config = new Config()
		const client = createAgentClient(config)
		assert.equal(client instanceof OpenAICompatibleChatClient, true)
	} finally {
		for (const [key, value] of Object.entries(previousEnv)) {
			if (typeof value === 'undefined') {
				delete process.env[key]
			} else {
				process.env[key] = value
			}
		}
	}
})

test('client facade keeps stable exports while dedicated client modules own the implementation', async () => {
	const [contracts, factory, chatModule, responsesModule, facade] =
		await Promise.all([
			import('../../ai/contracts/agentClient.js'),
			import('../../ai/client/factory.js'),
			import('../../ai/client/chatClient.js'),
			import('../../ai/client/responsesClient.js'),
			import('../../ai/client.js')
		])

	assert.equal('parseArguments' in contracts, false)
	assert.equal(typeof factory.createAgentClient, 'function')
	assert.equal(typeof chatModule.OpenAICompatibleChatClient, 'function')
	assert.equal(typeof responsesModule.OpenAIResponsesClient, 'function')
	assert.equal(facade.createAgentClient, factory.createAgentClient)
	assert.equal(
		facade.OpenAICompatibleChatClient,
		chatModule.OpenAICompatibleChatClient
	)
	assert.equal(
		facade.OpenAIResponsesClient,
		responsesModule.OpenAIResponsesClient
	)
})
