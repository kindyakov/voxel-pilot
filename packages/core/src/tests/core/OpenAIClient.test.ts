import assert from 'node:assert/strict'
import test from 'node:test'

import {
	OpenAIResponsesClient,
	type ParsedToolCall,
	type ParsedToolResponse
} from '../../ai/client.js'
import Logger from '../../config/logger.js'

test('OpenAIResponsesClient maps parsed function calls into compact tool calls', async () => {
	const parsedResponse: ParsedToolResponse = {
		id: 'resp_123',
		output_text: 'Need to read memory',
		output: [
			{
				type: 'function_call',
				call_id: 'call_1',
				name: 'memory_read',
				arguments: '{"query_tags":["wood"],"max_distance":64}',
				parsed_arguments: {
					query_tags: ['wood'],
					max_distance: 64
				}
			}
		]
	}

	const calls: any[] = []
	const client = new OpenAIResponsesClient({
		apiKey: 'test-key',
		model: 'gpt-5-mini',
		timeoutMs: 5000,
		client: {
			responses: {
				create: async (payload: unknown) => {
					calls.push(payload)
					return parsedResponse
				}
			}
		} as any
	})

	const response = await client.createResponse({
		instructions: 'test instructions',
		input: 'test input',
		tools: []
	})

	assert.equal(calls.length, 1)
	assert.equal(response.id, 'resp_123')
	assert.equal(response.outputText, 'Need to read memory')
	assert.deepEqual(response.toolCalls satisfies ParsedToolCall[], [
		{
			callId: 'call_1',
			name: 'memory_read',
			arguments: {
				query_tags: ['wood'],
				max_distance: 64
			}
		}
	])
})

test('OpenAIResponsesClient skips request dumps unless AI_DEBUG_DUMP is enabled', async () => {
	const previousFlag = process.env.AI_DEBUG_DUMP
	delete process.env.AI_DEBUG_DUMP

	const captured: string[] = []
	const original = Logger.info
	Logger.info = ((message: string) => {
		captured.push(message)
	}) as typeof Logger.info

	try {
		const client = new OpenAIResponsesClient({
			apiKey: 'test-key',
			model: 'gpt-5-mini',
			timeoutMs: 5000,
			client: {
				responses: {
					create: async () => ({
						id: 'resp_no_dump',
						output_text: '',
						output: []
					})
				}
			} as any
		})

		await client.createResponse({
			instructions: 'test instructions',
			input: 'test input',
			tools: []
		})
	} finally {
		Logger.info = original
		if (typeof previousFlag === 'undefined') {
			delete process.env.AI_DEBUG_DUMP
		} else {
			process.env.AI_DEBUG_DUMP = previousFlag
		}
	}

	assert.equal(
		captured.some(log => log.includes('[AI] model_request_dump')),
		false
	)
})

test('OpenAIResponsesClient falls back to JSON arguments and drops non-call items', async () => {
	const parsedResponse: ParsedToolResponse = {
		id: 'resp_fallback',
		output_text: '',
		output: [
			{
				type: 'function_call',
				call_id: 'call_1',
				name: 'navigate_to',
				arguments: '{"position":{"x":1,"y":64,"z":1}}'
			},
			{
				type: 'function_call',
				call_id: 'call_2',
				name: 'inspect_blocks',
				arguments: 'not-json{{{'
			},
			{
				type: 'reasoning',
				id: 'rs_1',
				summary: []
			}
		]
	}

	const client = new OpenAIResponsesClient({
		apiKey: 'test-key',
		model: 'gpt-5-mini',
		timeoutMs: 5000,
		client: {
			responses: {
				create: async () => parsedResponse
			}
		} as any
	})

	const response = await client.createResponse({
		instructions: 'test instructions',
		input: 'test input',
		tools: []
	})

	assert.deepEqual(response.toolCalls satisfies ParsedToolCall[], [
		{
			callId: 'call_1',
			name: 'navigate_to',
			arguments: {
				position: { x: 1, y: 64, z: 1 }
			}
		},
		{
			callId: 'call_2',
			name: 'inspect_blocks',
			arguments: {}
		}
	])
})
