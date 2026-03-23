import assert from 'node:assert/strict'
import test from 'node:test'

import {
	OpenAIResponsesClient,
	type ParsedToolCall,
	type ParsedToolResponse
} from '../../ai/client.js'

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
