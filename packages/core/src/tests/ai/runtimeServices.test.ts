import assert from 'node:assert/strict'
import {
	mkdir,
	mkdtemp,
	readFile,
	readdir,
	rm,
	writeFile
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'

import {
	OpenAICompatibleChatClient,
	OpenAIResponsesClient
} from '../../ai/client.js'
import type { ChatCompletionMessageLike } from '../../ai/contracts/agentClient.js'
import type { AgentTurnInput } from '../../ai/contracts/agentTurn.js'
import { createAgentTurnRunner } from '../../ai/loop.js'
import { createTaskContext } from '../../ai/taskContext.js'
import type { AIConfig } from '../../config/runtimeConfig.js'
import type { RuntimeLogRecord } from '../../config/runtimeLogger.js'
import { MemoryManager } from '../../core/memory/index.js'
import { HandoffBot } from '../hsm/fixtures/handoffBot.js'
import {
	createTestAgentDependencies,
	createTestClientOptions,
	createTestLogger
} from './fixtures/runtimeServices.js'

function createInput(): AgentTurnInput {
	const bot = new HandoffBot().asBot()
	const memory = new MemoryManager({
		botName: 'turn-fixture',
		dataDir: tmpdir()
	})
	bot.memory = memory
	return {
		bot,
		memory,
		currentGoal: 'Complete fixture goal',
		subGoal: null,
		lastAction: null,
		lastResult: null,
		lastReason: null,
		errorHistory: [],
		taskContext: createTaskContext('Complete fixture goal', null)
	}
}

const finishedResponse = {
	id: 'chat_fixture',
	choices: [
		{
			message: {
				content: '',
				tool_calls: [
					{
						id: 'finish_call',
						type: 'function',
						function: {
							name: 'finish_goal',
							arguments: '{"message":"Done"}'
						}
					}
				]
			}
		}
	]
} satisfies {
	id: string
	choices: Array<{ message: ChatCompletionMessageLike }>
}

test('default runners use instance models, keys and loggers and create chat history per turn', async t => {
	const calls: Array<{
		url: string
		model: unknown
		authorization: string | null
		messages: number
	}> = []
	t.mock.method(
		globalThis,
		'fetch',
		async (request: string | URL | Request, init?: RequestInit) => {
			assert.ok(typeof init?.body === 'string')
			const body: Record<string, unknown> = JSON.parse(init.body)
			assert.ok(Array.isArray(body.messages))
			calls.push({
				url: request instanceof Request ? request.url : String(request),
				model: body.model,
				authorization: new Headers(init.headers).get('authorization'),
				messages: body.messages.length
			})
			return new Response(JSON.stringify(finishedResponse), {
				headers: { 'content-type': 'application/json' }
			})
		}
	)
	const recordsA: RuntimeLogRecord[] = [],
		recordsB: RuntimeLogRecord[] = []
	const loggerA = createTestLogger(recordsA),
		loggerB = createTestLogger(recordsB)
	loggerA.setCorrelationId('instance-a')
	loggerB.setCorrelationId('instance-b')
	const common = createTestAgentDependencies()
	const aiA: AIConfig = {
		...common.ai,
		provider: 'routerai',
		model: 'model-a',
		apiKey: 'key-a',
		baseUrl: 'https://a.invalid/v1'
	}
	const aiB: AIConfig = {
		...common.ai,
		provider: 'routerai',
		model: 'model-b',
		apiKey: 'key-b',
		baseUrl: 'https://b.invalid/v1'
	}
	const runnerA = createAgentTurnRunner({ ...common, ai: aiA, logger: loggerA })
	const runnerB = createAgentTurnRunner({ ...common, ai: aiB, logger: loggerB })
	assert.equal((await runnerA(createInput())).kind, 'finish')
	assert.equal((await runnerA(createInput())).kind, 'finish')
	assert.equal((await runnerB(createInput())).kind, 'finish')
	assert.deepEqual(
		calls.map(call => [
			call.url,
			call.model,
			call.authorization,
			call.messages
		]),
		[
			['https://a.invalid/v1/chat/completions', 'model-a', 'Bearer key-a', 2],
			['https://a.invalid/v1/chat/completions', 'model-a', 'Bearer key-a', 2],
			['https://b.invalid/v1/chat/completions', 'model-b', 'Bearer key-b', 2]
		]
	)
	assert.ok(recordsA.length > 0 && recordsB.length > 0)
	assert.ok(recordsA.every(record => record.correlationId === 'instance-a'))
	assert.ok(recordsB.every(record => record.correlationId === 'instance-b'))
})

test('input client bypasses default client construction and cancellation still stops requests', async () => {
	const common = createTestAgentDependencies()
	const runner = createAgentTurnRunner({
		...common,
		ai: { ...common.ai, provider: 'openai', apiKey: undefined }
	})
	let calls = 0
	const input = createInput()
	input.client = {
		createResponse: async () => {
			calls++
			return {
				id: 'override',
				outputText: '',
				toolCalls: [
					{
						callId: 'finish',
						name: 'finish_goal',
						arguments: { message: 'Override done' }
					}
				]
			}
		}
	}
	const result = await runner(input)
	assert.equal(result.kind, 'finish')
	assert.equal(calls, 1)
	const cancellation = new AbortController()
	cancellation.abort()
	await assert.rejects(
		runner({ ...input, signal: cancellation.signal }),
		/aborted/
	)
	assert.equal(calls, 1)
})

test('provider errors redact instance credentials without changing transport classification', async () => {
	const records: RuntimeLogRecord[] = []
	const common = createTestAgentDependencies()
	const apiKey = 'private-instance-key'
	const baseUrl =
		'https://private-user:private-password@fixture.invalid/v1?api_key=private-query'
	const runner = createAgentTurnRunner({
		...common,
		logger: createTestLogger(records),
		ai: { ...common.ai, provider: 'routerai', apiKey, baseUrl }
	})
	const input = createInput()
	input.client = {
		createResponse: async () => {
			throw Object.assign(
				new Error(`Request ${baseUrl} failed for ${apiKey} private-query`),
				{ code: 'ECONNRESET' }
			)
		}
	}
	const result = await runner(input)
	assert.equal(result.kind, 'failed')
	assert.ok(result.kind === 'failed' && result.isTransport)
	const exposed = JSON.stringify({ result, records })
	for (const secret of [
		apiKey,
		'private-user',
		'private-password',
		'private-query'
	])
		assert.ok(!exposed.includes(secret))
	assert.match(exposed, /REDACTED/)
})

test('model failures share instance redaction for fragments, encoding and percent-case while preserving useful context', async () => {
	const common = createTestAgentDependencies()
	const apiKey = 'review/key/value'
	const endpoint = new URL('https://fixture.invalid/v1')
	endpoint.username = 'review/user'
	endpoint.password = 'review/password'
	endpoint.searchParams.set('token', 'review/query')
	endpoint.hash = 'review%2Ffragment'
	const baseUrl = endpoint.toString()
	const credentials = [
		apiKey,
		'review/user',
		'review/password',
		'review/query',
		'review/fragment'
	]
	const forms = credentials.flatMap(value => [
		value,
		encodeURIComponent(value),
		encodeURIComponent(value).replace(/%[A-F\d]{2}/g, escape =>
			escape.toLowerCase()
		)
	])
	for (const failure of [
		Object.assign(
			new Error(`context-preserved ${baseUrl} ${forms.join(' ')}`),
			{ code: 'ECONNRESET' }
		),
		`text-context-preserved ${forms.join(' ')}`
	]) {
		const records: RuntimeLogRecord[] = []
		const runner = createAgentTurnRunner({
			...common,
			logger: createTestLogger(records),
			ai: { ...common.ai, provider: 'routerai', apiKey, baseUrl }
		})
		const input = createInput()
		input.client = {
			async createResponse() {
				throw failure
			}
		}
		const result = await runner(input)
		assert.equal(result.kind, 'failed')
		assert.ok(
			result.kind === 'failed' && result.reason.includes('context-preserved')
		)
		assert.ok(
			result.kind === 'failed' &&
				result.isTransport === failure instanceof Error
		)
		const exposed = JSON.stringify({ result, records })
		for (const form of forms)
			assert.ok(
				!exposed.includes(form),
				'known instance credential form must remain private'
			)
		assert.match(exposed, /REDACTED/)
	}
})

test('chat and responses dumps use selected directories, remain opt-in and keep private text out of logs', async t => {
	const temporary = await mkdtemp(join(tmpdir(), 'voxel-pilot-ai-services-'))
	t.after(async () => {
		assert.equal(dirname(resolve(temporary)), resolve(tmpdir()))
		assert.ok(temporary.includes('voxel-pilot-ai-services-'))
		await rm(temporary, { recursive: true, force: true })
	})
	const previous = process.env.AI_DEBUG_DUMP
	process.env.AI_DEBUG_DUMP = '1'
	t.after(() => {
		if (previous === undefined) delete process.env.AI_DEBUG_DUMP
		else process.env.AI_DEBUG_DUMP = previous
	})
	const records: RuntimeLogRecord[] = []
	const logger = createTestLogger(records)
	const chatDirectory = join(temporary, 'chat'),
		responseDirectory = join(temporary, 'responses'),
		disabledDirectory = join(temporary, 'disabled')
	await mkdir(chatDirectory)
	await Promise.all(
		Array.from({ length: 51 }, (_, index) =>
			writeFile(
				join(
					chatDirectory,
					`chat-request-2000-${String(index).padStart(3, '0')}.md`
				),
				'old'
			)
		)
	)
	const chat = new OpenAICompatibleChatClient({
		...createTestClientOptions({
			logger,
			debugDump: { enabled: true, directory: chatDirectory }
		}),
		client: { chat: { completions: { create: async () => finishedResponse } } }
	})
	const responses = new OpenAIResponsesClient({
		...createTestClientOptions({
			logger,
			debugDump: { enabled: true, directory: responseDirectory }
		}),
		client: {
			responses: { create: async () => ({ id: 'responses', output: [] }) }
		}
	})
	const disabled = new OpenAIResponsesClient({
		...createTestClientOptions({
			logger,
			debugDump: { enabled: false, directory: disabledDirectory }
		}),
		client: {
			responses: { create: async () => ({ id: 'disabled', output: [] }) }
		}
	})
	const request = {
		instructions: 'private-prompt-fixture',
		input: 'private-user-fixture',
		tools: []
	}
	await chat.createResponse(request)
	await responses.createResponse(request)
	await disabled.createResponse(request)
	assert.equal((await readdir(chatDirectory)).length, 50)
	assert.equal((await readdir(responseDirectory)).length, 1)
	await assert.rejects(readdir(disabledDirectory), { code: 'ENOENT' })
	const dumpRecords = records.filter(
		record => record.message === '[AI] model_request_dump'
	)
	assert.equal(dumpRecords.length, 2)
	for (const record of dumpRecords) {
		assert.ok(typeof record.meta.path === 'string')
		const markdown = await readFile(record.meta.path, 'utf8')
		assert.match(markdown, /private-prompt-fixture/)
		assert.ok(!markdown.includes('test-key'))
		assert.ok(
			[chatDirectory, responseDirectory].includes(dirname(record.meta.path))
		)
	}
	assert.ok(!JSON.stringify(records).includes('private-prompt-fixture'))
	assert.ok(!JSON.stringify(records).includes('private-user-fixture'))
})

test('explicit SDK policy fixes endpoint, auth, tenant headers and disables SDK console logging', async t => {
	const values = {
		OPENAI_API_KEY: 'ambient-key-fixture',
		OPENAI_BASE_URL: 'https://ambient.invalid/v1',
		OPENAI_ORG_ID: 'ambient-org-fixture',
		OPENAI_PROJECT_ID: 'ambient-project-fixture',
		OPENAI_ADMIN_KEY: 'ambient-admin-fixture',
		OPENAI_WEBHOOK_SECRET: 'ambient-webhook-fixture',
		OPENAI_LOG: 'debug',
		OPENAI_CUSTOM_HEADERS: ''
	}
	const previous = new Map(
		Object.keys(values).map(key => [key, process.env[key]])
	)
	Object.assign(process.env, values)
	t.after(() => {
		for (const [key, value] of previous) {
			if (value === undefined) delete process.env[key]
			else process.env[key] = value
		}
	})
	let consoleCalls = 0
	for (const method of ['debug', 'info', 'log', 'warn', 'error'] as const)
		t.mock.method(console, method, () => {
			consoleCalls++
		})
	const calls: Array<{ url: string; authorization: string | null }> = []
	t.mock.method(
		globalThis,
		'fetch',
		async (request: string | URL | Request, init?: RequestInit) => {
			const headers = new Headers(init?.headers)
			assert.equal(headers.get('openai-organization'), null)
			assert.equal(headers.get('openai-project'), null)
			const url = request instanceof Request ? request.url : String(request)
			calls.push({ url, authorization: headers.get('authorization') })
			return new Response(
				JSON.stringify(
					url.endsWith('/responses')
						? { id: 'responses-fixture', output: [] }
						: finishedResponse
				),
				{
					headers: { 'content-type': 'application/json' }
				}
			)
		}
	)
	const chat = new OpenAICompatibleChatClient(
		createTestClientOptions({ baseUrl: undefined })
	)
	const responses = new OpenAIResponsesClient(
		createTestClientOptions({ baseUrl: 'https://selected.invalid/v1' })
	)
	const request = {
		instructions: 'private-sdk-policy-fixture',
		input: 'fixture',
		tools: []
	}
	await chat.createResponse(request)
	await responses.createResponse(request)
	assert.deepEqual(calls, [
		{
			url: 'https://api.openai.com/v1/chat/completions',
			authorization: 'Bearer test-key'
		},
		{
			url: 'https://selected.invalid/v1/responses',
			authorization: 'Bearer test-key'
		}
	])
	assert.equal(consoleCalls, 0)
})

test('configured authorization and tenant policy win over ambient SDK headers for both clients', async t => {
	const previousHeaders = process.env.OPENAI_CUSTOM_HEADERS
	const previousLogLevel = process.env.OPENAI_LOG
	process.env.OPENAI_LOG = 'debug'
	t.after(() => {
		if (previousHeaders === undefined) delete process.env.OPENAI_CUSTOM_HEADERS
		else process.env.OPENAI_CUSTOM_HEADERS = previousHeaders
		if (previousLogLevel === undefined) delete process.env.OPENAI_LOG
		else process.env.OPENAI_LOG = previousLogLevel
	})
	const records: RuntimeLogRecord[] = []
	const logger = createTestLogger(records)
	let consoleCalls = 0
	for (const method of ['debug', 'info', 'log', 'warn', 'error'] as const)
		t.mock.method(console, method, () => {
			consoleCalls++
		})
	let requests = 0
	t.mock.method(
		globalThis,
		'fetch',
		async (request: string | URL | Request, init?: RequestInit) => {
			const headers = new Headers(init?.headers)
			assert.equal(headers.get('authorization'), 'Bearer test-key')
			assert.equal(headers.get('openai-organization'), null)
			assert.equal(headers.get('openai-project'), null)
			assert.equal(headers.get('x-fixture-header'), 'preserved-fixture')
			requests++
			const url = request instanceof Request ? request.url : String(request)
			return new Response(
				JSON.stringify(
					url.endsWith('/responses')
						? { id: 'responses-fixture', output: [] }
						: finishedResponse
				),
				{
					headers: { 'content-type': 'application/json' }
				}
			)
		}
	)
	for (const name of ['Authorization', 'authorization', 'aUtHoRiZaTiOn']) {
		process.env.OPENAI_CUSTOM_HEADERS = [
			`${name}: Bearer ambient-header-key-fixture`,
			'OpenAI-Organization: ambient-org-fixture',
			'openai-project: ambient-project-fixture',
			'X-Fixture-Header: preserved-fixture'
		].join('\n')
		const options = createTestClientOptions({ logger })
		const clients = [
			new OpenAICompatibleChatClient(options),
			new OpenAIResponsesClient(options)
		]
		for (const client of clients)
			await client.createResponse({
				instructions: 'private-auth-policy-fixture',
				input: 'fixture',
				tools: []
			})
	}
	assert.equal(requests, 6)
	assert.equal(consoleCalls, 0)
	assert.ok(!JSON.stringify(records).includes('test-key'))
	assert.ok(!JSON.stringify(records).includes('ambient-header-key-fixture'))
	assert.ok(!JSON.stringify(records).includes('private-auth-policy-fixture'))
})

test('explicit clients reject missing keys instead of inheriting ambient SDK credentials', t => {
	const previous = process.env.OPENAI_API_KEY
	process.env.OPENAI_API_KEY = 'ambient-test-key'
	t.after(() => {
		if (previous === undefined) delete process.env.OPENAI_API_KEY
		else process.env.OPENAI_API_KEY = previous
	})
	const options = createTestClientOptions({ apiKey: undefined })
	assert.throws(() => new OpenAIResponsesClient(options), /Explicit AI API key/)
	assert.throws(
		() => new OpenAICompatibleChatClient(options),
		/Explicit AI API key/
	)
	for (const apiKey of ['', ' ', '\t\n']) {
		const blank = createTestClientOptions({ apiKey })
		assert.throws(() => new OpenAIResponsesClient(blank), /Explicit AI API key/)
		assert.throws(
			() => new OpenAICompatibleChatClient(blank),
			/Explicit AI API key/
		)
	}
})
