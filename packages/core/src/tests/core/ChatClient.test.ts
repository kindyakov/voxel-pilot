import assert from 'node:assert/strict'
import test from 'node:test'

import {
	AI_PILOT_UNAVAILABLE_REASON,
	type DisabledAiProvider,
	NoOpAgentClient,
	OpenAICompatibleChatClient,
	type ParsedToolCall,
	createAgentClient
} from '../../ai/client.js'
import {
	isRetryableApiError,
	isTransportApiError
} from '../../ai/client/retry.js'
import type { AIConfig } from '../../config/runtimeConfig.js'
import { createTestClientOptions } from '../ai/fixtures/runtimeServices.js'

test('OpenAICompatibleChatClient maps chat completion tool calls into compact tool calls', async () => {
	const calls: any[] = []
	const client = new OpenAICompatibleChatClient({
		...createTestClientOptions(),
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
		...createTestClientOptions(),
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
	const ai: AIConfig = {
		provider: 'routerai',
		baseUrl: 'https://routerai.ru/api/v1',
		apiKey: 'router-key',
		model: 'z-ai/glm-4.7-flash',
		timeout: 15000,
		maxTokens: 800
	}
	const client = createAgentClient(ai, createTestClientOptions())
	assert.equal(client instanceof OpenAICompatibleChatClient, true)
})

test('createAgentClient selects a pause-worthy network-free client', async () => {
	const providers: DisabledAiProvider[] = ['disabled', 'local']
	for (const provider of providers) {
		const config: { ai: AIConfig } = {
			ai: {
				provider,
				baseUrl: undefined,
				model: provider,
				apiKey: undefined,
				timeout: 1,
				maxTokens: 1
			}
		}
		const client = createAgentClient(config.ai, createTestClientOptions())

		assert.equal(client instanceof NoOpAgentClient, true)
		await assert.rejects(
			client.createResponse({ instructions: '', input: '', tools: [] }),
			error => {
				assert.equal(
					error instanceof Error ? error.message : String(error),
					AI_PILOT_UNAVAILABLE_REASON
				)
				assert.equal(isTransportApiError(error), true)
				assert.equal(isRetryableApiError(error), false)
				return true
			}
		)
	}
})
