import assert from 'node:assert/strict'
import test from 'node:test'

import {
	buildChatRequestDebugMarkdown,
	buildResponsesRequestDebugMarkdown
} from '../../ai/client/requestDebugDump.js'
import { assembleAgentPrompt } from '../../ai/prompt.js'

const createVec3 = (x: number, y: number, z: number) => ({
	x,
	y,
	z
})

test('buildResponsesRequestDebugMarkdown renders the full responses payload', () => {
	const promptAssembly = assembleAgentPrompt({
		bot: {
			health: 20,
			food: 20,
			oxygenLevel: 20,
			entity: {
				position: createVec3(0, 64, 0)
			}
		} as any,
		currentGoal: 'Check inventory',
		subGoal: null,
		conversationHistory: [
			{
				role: 'user',
				username: 'Smidvard',
				message: 'answer in Russian'
			}
		],
		lastAction: null,
		lastResult: null,
		lastReason: null,
		errorHistory: [],
		activeWindowSession: null,
		activeWindowSessionState: null,
		userProfilePrompt: {
			persona: 'Helpful assistant',
			style: 'brief',
			defaultLanguage: 'ru',
			selfDescription: null,
			tone: 'calm',
			behaviorPreferences: []
		},
		tools: [
			{
				type: 'function',
				name: 'inspect_inventory',
				description: 'Inspect the player inventory.',
				strict: true,
				parameters: {
					type: 'object',
					additionalProperties: false,
					properties: {},
					required: []
				}
			}
		]
	})

	const markdown = buildResponsesRequestDebugMarkdown({
		model: 'gpt-test',
		instructions: promptAssembly.instructions,
		input: promptAssembly.input,
		tools: promptAssembly.toolContract.tools,
		parallelToolCalls: false,
		previousResponseId: 'resp_prev',
		maxOutputTokens: 1200,
		toolChoice: 'auto',
		promptAssembly
	})

	assert.match(markdown, /^# AI Responses Request Dump/m)
	assert.match(markdown, /## Request Body/)
	assert.match(markdown, /"model": "gpt-test"/)
	assert.match(markdown, /"previous_response_id": "resp_prev"/)
	assert.match(markdown, /## Core Policy/)
	assert.match(markdown, /## User Profile Prompt/)
	assert.match(markdown, /## Runtime Context/)
	assert.match(markdown, /## Conversation Context/)
	assert.match(markdown, /## Tool Contract/)
	assert.match(markdown, /### `inspect_inventory`/)
	assert.match(markdown, /Inspect the player inventory\./)
	assert.match(markdown, /answer in Russian/)
})

test('buildChatRequestDebugMarkdown renders the full chat payload', () => {
	const promptAssembly = assembleAgentPrompt({
		bot: {
			health: 20,
			food: 20,
			oxygenLevel: 20,
			entity: {
				position: createVec3(0, 64, 0)
			}
		} as any,
		currentGoal: 'Say hello',
		subGoal: null,
		conversationHistory: [
			{ role: 'user', username: 'Smidvard', message: 'Привет' }
		],
		lastAction: null,
		lastResult: null,
		lastReason: null,
		errorHistory: [],
		activeWindowSession: null,
		activeWindowSessionState: null,
		userProfilePrompt: {
			persona: 'Friendly assistant',
			style: 'brief',
			defaultLanguage: 'ru',
			selfDescription: null,
			tone: 'warm',
			behaviorPreferences: []
		},
		tools: []
	})

	const markdown = buildChatRequestDebugMarkdown({
		model: 'gpt-chat-test',
		systemPrompt: promptAssembly.instructions,
		messages: [
			{ role: 'system', content: promptAssembly.instructions },
			{ role: 'user', content: 'Привет' }
		],
		tools: [],
		toolChoice: 'auto',
		maxTokens: 800,
		temperature: 0,
		stream: false,
		promptAssembly
	})

	assert.match(markdown, /^# AI Chat Request Dump/m)
	assert.match(markdown, /## Request Body/)
	assert.match(markdown, /"model": "gpt-chat-test"/)
	assert.match(markdown, /"max_tokens": 800/)
	assert.match(markdown, /## Core Policy/)
	assert.match(markdown, /## User Profile Prompt/)
	assert.match(markdown, /## Runtime Context/)
	assert.match(markdown, /## Conversation Context/)
	assert.match(markdown, /## Messages/)
	assert.match(markdown, /"role": "user"/)
	assert.match(markdown, /Привет/)
})
