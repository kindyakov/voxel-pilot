import assert from 'node:assert/strict'
import { once } from 'node:events'
import {
	type IncomingMessage,
	type ServerResponse,
	createServer
} from 'node:http'
import test from 'node:test'

import {
	type AgentSdkEvent,
	AgentSdkPilotError,
	type AgentSdkTool,
	createAgentsSdkPilot
} from '../../ai/agentSdkPilot.js'

interface ChatCompletionMessage {
	role?: string
	content?: unknown
	tool_call_id?: string
	tool_calls?: readonly Record<string, unknown>[]
	[key: string]: unknown
}

interface ChatCompletionRequest {
	model?: string
	stream?: boolean
	messages?: readonly ChatCompletionMessage[]
	[key: string]: unknown
}

interface TestChatServer {
	requests: ChatCompletionRequest[]
	url: string
	close: () => Promise<void>
}

const readJsonBody = async (
	request: IncomingMessage
): Promise<ChatCompletionRequest> => {
	let body = ''
	for await (const chunk of request) {
		body += String(chunk)
	}
	return JSON.parse(body) as ChatCompletionRequest
}

const sendJson = (response: ServerResponse, body: unknown): void => {
	response.writeHead(200, { 'content-type': 'application/json' })
	response.end(JSON.stringify(body))
}

const sendStream = async (
	response: ServerResponse,
	chunks: unknown[],
	options?: { keepOpen?: boolean }
): Promise<void> => {
	response.writeHead(200, {
		'cache-control': 'no-cache',
		connection: 'keep-alive',
		'content-type': 'text/event-stream'
	})

	for (const chunk of chunks) {
		response.write(`data: ${JSON.stringify(chunk)}\n\n`)
	}
	if (!options?.keepOpen) {
		response.write('data: [DONE]\n\n')
		response.end()
	}
}

const createTestChatServer = async (
	handle: (
		body: ChatCompletionRequest,
		response: ServerResponse,
		requestNumber: number
	) => Promise<void>
): Promise<TestChatServer> => {
	const requests: ChatCompletionRequest[] = []
	const server = createServer(async (request, response) => {
		try {
			const body = await readJsonBody(request)
			requests.push(body)
			await handle(body, response, requests.length)
		} catch (error) {
			if (!response.headersSent) {
				response.writeHead(500, { 'content-type': 'text/plain' })
			}
			response.end(error instanceof Error ? error.message : String(error))
		}
	})
	server.listen(0, '127.0.0.1')
	await once(server, 'listening')
	const address = server.address()
	if (!address || typeof address === 'string') {
		throw new Error('Test server did not expose a TCP address')
	}

	return {
		requests,
		url: `http://127.0.0.1:${address.port}/v1`,
		close: async () => {
			server.closeAllConnections()
			server.close()
			await once(server, 'close')
		}
	}
}

const waitFor = async (predicate: () => boolean): Promise<void> => {
	const deadline = Date.now() + 2000
	while (!predicate()) {
		if (Date.now() >= deadline) {
			throw new Error('Timed out waiting for test server request')
		}
		await new Promise(resolve => setTimeout(resolve, 10))
	}
}

const safeInspectTool: AgentSdkTool = {
	name: 'inspect_safe',
	description: 'Inspect the requested safe test target.',
	strict: true,
	parameters: {
		type: 'object',
		properties: {
			target: { type: 'string' }
		},
		required: ['target'],
		additionalProperties: false
	},
	execute: async args => ({ ok: true, ...(args as Record<string, unknown>) })
}

test('Agents SDK pilot uses the configured RouterAI model and continues after a tool call', async () => {
	const server = await createTestChatServer(
		async (_body, response, requestNumber) => {
			if (requestNumber === 1) {
				sendJson(response, {
					id: 'chatcmpl_tool',
					choices: [
						{
							finish_reason: 'tool_calls',
							message: {
								content: null,
								role: 'assistant',
								tool_calls: [
									{
										id: 'call_inspect',
										type: 'function',
										function: {
											arguments: '{"target":"oak"}',
											name: 'inspect_safe'
										}
									}
								]
							}
						}
					]
				})
				return
			}

			sendJson(response, {
				id: 'chatcmpl_final',
				choices: [
					{
						finish_reason: 'stop',
						message: { content: 'Проверка завершена.', role: 'assistant' }
					}
				]
			})
		}
	)

	try {
		const pilot = createAgentsSdkPilot({
			apiKey: 'test-router-key',
			baseUrl: server.url,
			instructions: 'Use the safe inspection tool when it helps.',
			model: 'router/test-model',
			tools: [safeInspectTool]
		})

		const result = await pilot.run('Проверь дуб рядом со мной')

		assert.equal(result.outputText, 'Проверка завершена.')
		assert.equal(server.requests.length, 2)
		assert.equal(server.requests[0]?.model, 'router/test-model')
		assert.equal(server.requests[0]?.stream, false)
		assert.equal(server.requests[1]?.stream, false)
		assert.ok(
			server.requests[1]?.messages?.some(
				message =>
					message.role === 'tool' && message.tool_call_id === 'call_inspect'
			)
		)
		assert.ok(pilot.history().some(item => item.role === 'assistant'))
	} finally {
		await server.close()
	}
})

test('non-stream failures preserve completed tool history for the next request', async () => {
	let toolExecuted = false
	const server = await createTestChatServer(
		async (_body, response, requestNumber) => {
			if (requestNumber === 1) {
				sendJson(response, {
					id: 'chatcmpl_non_stream_tool',
					choices: [
						{
							finish_reason: 'tool_calls',
							message: {
								content: null,
								role: 'assistant',
								tool_calls: [
									{
										id: 'call_non_stream_tool',
										type: 'function',
										function: {
											arguments: '{"target":"oak"}',
											name: 'inspect_safe'
										}
									}
								]
							}
						}
					]
				})
				return
			}
			if (requestNumber === 2) {
				response.writeHead(503, { 'content-type': 'application/json' })
				response.end(JSON.stringify({ error: 'temporary failure' }))
				return
			}

			sendJson(response, {
				id: 'chatcmpl_non_stream_after',
				choices: [
					{
						finish_reason: 'stop',
						message: { content: 'Продолжаю.', role: 'assistant' }
					}
				]
			})
		}
	)

	try {
		const pilot = createAgentsSdkPilot({
			apiKey: 'test-router-key',
			baseUrl: server.url,
			instructions: 'Use the safe inspection tool.',
			model: 'router/non-stream-history-model',
			tools: [
				{
					...safeInspectTool,
					execute: async args => {
						toolExecuted = true
						return safeInspectTool.execute(args, {})
					}
				}
			]
		})

		await assert.rejects(
			pilot.run('Осмотри дуб'),
			error => error instanceof AgentSdkPilotError && error.kind === 'transport'
		)
		assert.equal(toolExecuted, true)
		assert.ok(
			pilot
				.history()
				.some(
					item => item.role === 'tool' && item.callId === 'call_non_stream_tool'
				)
		)

		await pilot.run('Продолжи после ошибки')
		assert.ok(
			server.requests[2]?.messages?.some(
				message =>
					message.role === 'tool' &&
					message.tool_call_id === 'call_non_stream_tool'
			)
		)
	} finally {
		await server.close()
	}
})

test('Agents SDK pilot exposes streamed text events', async () => {
	const server = await createTestChatServer(async (body, response) => {
		assert.equal(body.stream, true)
		await sendStream(response, [
			{
				id: 'chatcmpl_stream',
				choices: [
					{
						index: 0,
						delta: { content: 'Поток', role: 'assistant' },
						finish_reason: null
					}
				]
			},
			{
				id: 'chatcmpl_stream',
				choices: [
					{
						index: 0,
						delta: { content: ' готов.' },
						finish_reason: 'stop'
					}
				]
			}
		])
	})

	try {
		const pilot = createAgentsSdkPilot({
			apiKey: 'test-router-key',
			baseUrl: server.url,
			instructions: 'Answer briefly.',
			model: 'router/stream-model'
		})
		const events: AgentSdkEvent[] = []

		for await (const event of pilot.stream('Скажи статус')) {
			events.push(event)
		}

		assert.deepEqual(
			events
				.filter(event => event.type === 'text_delta')
				.map(event => event.delta),
			['Поток', ' готов.']
		)
		assert.deepEqual(events.at(-1), {
			runId: events[0]?.runId,
			type: 'completed',
			outputText: 'Поток готов.'
		})
	} finally {
		await server.close()
	}
})

test('streaming keeps tool call and tool result events in the SDK loop', async () => {
	const server = await createTestChatServer(
		async (_body, response, requestNumber) => {
			if (requestNumber === 1) {
				await sendStream(response, [
					{
						id: 'chatcmpl_stream_tool',
						choices: [
							{
								index: 0,
								delta: {
									role: 'assistant',
									tool_calls: [
										{
											index: 0,
											id: 'call_stream_inspect',
											type: 'function',
											function: {
												name: 'inspect_safe',
												arguments: '{"target":"birch"}'
											}
										}
									]
								},
								finish_reason: 'tool_calls'
							}
						]
					}
				])
				return
			}

			await sendStream(response, [
				{
					id: 'chatcmpl_stream_tool_done',
					choices: [
						{
							index: 0,
							delta: { content: 'Осмотр завершён.', role: 'assistant' },
							finish_reason: 'stop'
						}
					]
				}
			])
		}
	)

	try {
		const pilot = createAgentsSdkPilot({
			apiKey: 'test-router-key',
			baseUrl: server.url,
			instructions: 'Use the safe inspection tool.',
			model: 'router/stream-tool-model',
			tools: [safeInspectTool]
		})
		const events: AgentSdkEvent[] = []

		for await (const event of pilot.stream('Проверь берёзу')) {
			events.push(event)
		}

		const toolCall = events.find(event => event.type === 'tool_call')
		assert.deepEqual(
			toolCall && toolCall.type === 'tool_call' ? toolCall : null,
			{
				runId: events[0]?.runId,
				type: 'tool_call',
				callId: 'call_stream_inspect',
				name: 'inspect_safe',
				arguments: '{"target":"birch"}'
			}
		)
		const toolResult = events.find(event => event.type === 'tool_result')
		assert.deepEqual(
			toolResult && toolResult.type === 'tool_result' ? toolResult : null,
			{
				runId: events[0]?.runId,
				type: 'tool_result',
				callId: 'call_stream_inspect',
				name: 'inspect_safe',
				output: '{"ok":true,"target":"birch"}'
			}
		)
		assert.equal(events.at(-1)?.type, 'completed')
	} finally {
		await server.close()
	}
})

test('aborting a streamed run preserves the input for the next request', async () => {
	const server = await createTestChatServer(
		async (_body, response, requestNumber) => {
			if (requestNumber === 1) {
				await sendStream(
					response,
					[
						{
							id: 'chatcmpl_slow',
							choices: [
								{
									index: 0,
									delta: { content: 'Начинаю', role: 'assistant' },
									finish_reason: null
								}
							]
						}
					],
					{ keepOpen: true }
				)
				return
			}

			sendJson(response, {
				id: 'chatcmpl_after_abort',
				choices: [
					{
						finish_reason: 'stop',
						message: { content: 'Продолжаю.', role: 'assistant' }
					}
				]
			})
		}
	)

	try {
		const pilot = createAgentsSdkPilot({
			apiKey: 'test-router-key',
			baseUrl: server.url,
			instructions: 'Keep the conversation.',
			model: 'router/abort-model'
		})
		const controller = new AbortController()
		const stream = pilot.stream('Первое сообщение', {
			signal: controller.signal
		})
		const firstEvent = await stream.next()
		assert.equal(firstEvent.value?.type, 'run_started')
		await waitFor(() => server.requests.length >= 1)

		controller.abort()
		await assert.rejects(
			(async () => {
				for await (const _event of stream) {
					// Drain until the aborted SDK stream rejects.
				}
			})(),
			error =>
				error instanceof Error && 'kind' in error && error.kind === 'aborted'
		)

		await pilot.run('Второе сообщение')
		const userMessages = (server.requests[1]?.messages ?? [])
			.filter(message => message.role === 'user')
			.map(message => message.content)
		assert.deepEqual(userMessages, ['Первое сообщение', 'Второе сообщение'])
	} finally {
		await server.close()
	}
})

test('aborting after a tool call preserves the partial tool history', async () => {
	const server = await createTestChatServer(
		async (_body, response, requestNumber) => {
			if (requestNumber === 1) {
				await sendStream(response, [
					{
						id: 'chatcmpl_partial_tool',
						choices: [
							{
								index: 0,
								delta: {
									role: 'assistant',
									tool_calls: [
										{
											index: 0,
											id: 'call_partial_tool',
											type: 'function',
											function: {
												name: 'inspect_safe',
												arguments: '{"target":"oak"}'
											}
										}
									]
								},
								finish_reason: 'tool_calls'
							}
						]
					}
				])
				return
			}
			if (requestNumber === 2) {
				await sendStream(
					response,
					[
						{
							id: 'chatcmpl_partial_tool_waiting',
							choices: [
								{
									index: 0,
									delta: { content: 'Жду', role: 'assistant' },
									finish_reason: null
								}
							]
						}
					],
					{ keepOpen: true }
				)
				return
			}

			sendJson(response, {
				id: 'chatcmpl_partial_tool_after',
				choices: [
					{
						finish_reason: 'stop',
						message: { content: 'Продолжаю.', role: 'assistant' }
					}
				]
			})
		}
	)

	try {
		const pilot = createAgentsSdkPilot({
			apiKey: 'test-router-key',
			baseUrl: server.url,
			instructions: 'Use the safe inspection tool.',
			model: 'router/partial-history-model',
			tools: [safeInspectTool]
		})
		const controller = new AbortController()
		const stream = pilot.stream('Осмотри дуб', {
			signal: controller.signal
		})
		const started = await stream.next()
		assert.equal(started.value?.type, 'run_started')
		await waitFor(() => server.requests.length >= 1)

		let toolResultSeen = false
		while (!toolResultSeen) {
			const next = await stream.next()
			if (next.done) break
			toolResultSeen = next.value.type === 'tool_result'
		}
		assert.equal(toolResultSeen, true)
		await waitFor(() => server.requests.length >= 2)
		controller.abort()
		await assert.rejects(
			(async () => {
				await stream.next()
			})(),
			error => error instanceof AgentSdkPilotError && error.kind === 'aborted'
		)

		assert.ok(
			pilot
				.history()
				.some(
					item =>
						item.role === 'assistant' &&
						item.name === 'inspect_safe' &&
						item.callId === 'call_partial_tool'
				)
		)
		assert.ok(
			pilot
				.history()
				.some(
					item => item.role === 'tool' && item.callId === 'call_partial_tool'
				)
		)

		await pilot.run('Продолжи после отмены')
		assert.ok(
			server.requests[2]?.messages?.some(
				message =>
					message.role === 'tool' &&
					message.tool_call_id === 'call_partial_tool'
			)
		)
	} finally {
		await server.close()
	}
})

test('closing a stream cancels the SDK run before it can continue', async () => {
	let toolExecuted = false
	const server = await createTestChatServer(
		async (_body, response, requestNumber) => {
			if (requestNumber === 1) {
				await sendStream(response, [
					{
						id: 'chatcmpl_closed_stream',
						choices: [
							{
								index: 0,
								delta: {
									role: 'assistant',
									tool_calls: [
										{
											index: 0,
											id: 'call_closed_stream',
											type: 'function',
											function: {
												name: 'inspect_safe',
												arguments: '{"target":"oak"}'
											}
										}
									]
								},
								finish_reason: 'tool_calls'
							}
						]
					}
				])
				return
			}

			await sendStream(response, [], { keepOpen: true })
		}
	)

	try {
		const pilot = createAgentsSdkPilot({
			apiKey: 'test-router-key',
			baseUrl: server.url,
			instructions: 'Use the safe inspection tool.',
			model: 'router/closed-stream-model',
			tools: [
				{
					...safeInspectTool,
					execute: async (args, context) => {
						await new Promise<void>(resolve => {
							const timer = setTimeout(resolve, 100)
							context.signal?.addEventListener(
								'abort',
								() => {
									clearTimeout(timer)
									resolve()
								},
								{ once: true }
							)
						})
						if (context.signal?.aborted) {
							return { aborted: true }
						}
						toolExecuted = true
						return safeInspectTool.execute(args, {})
					}
				}
			]
		})
		const stream = pilot.stream('Осмотри дуб')
		const started = await stream.next()
		assert.equal(started.value?.type, 'run_started')
		await waitFor(() => server.requests.length >= 1)

		const closed = await stream.return(undefined)
		assert.equal(closed.done, true)
		await new Promise(resolve => setTimeout(resolve, 100))
		assert.ok(server.requests.length <= 2)
		assert.equal(toolExecuted, false)
	} finally {
		await server.close()
	}
})

test('closing a stream waits for an in-flight tool and keeps its outcome in history', async () => {
	let releaseTool: (() => void) | undefined
	let toolStarted = false
	const server = await createTestChatServer(
		async (_body, response, requestNumber) => {
			if (requestNumber === 1) {
				await sendStream(response, [
					{
						id: 'chatcmpl_close_in_flight',
						choices: [
							{
								index: 0,
								delta: {
									role: 'assistant',
									tool_calls: [
										{
											index: 0,
											id: 'call_close_in_flight',
											type: 'function',
											function: {
												name: 'inspect_safe',
												arguments: '{"target":"oak"}'
											}
										}
									]
								},
								finish_reason: 'tool_calls'
							}
						]
					}
				])
				return
			}

			await sendStream(response, [], { keepOpen: true })
		}
	)

	try {
		const pilot = createAgentsSdkPilot({
			apiKey: 'test-router-key',
			baseUrl: server.url,
			instructions: 'Use the safe inspection tool.',
			model: 'router/close-in-flight-model',
			tools: [
				{
					...safeInspectTool,
					execute: async args => {
						toolStarted = true
						await new Promise<void>(resolve => {
							releaseTool = resolve
						})
						return safeInspectTool.execute(args, {})
					}
				}
			]
		})
		const stream = pilot.stream('Осмотри дуб')
		const started = await stream.next()
		assert.equal(started.value?.type, 'run_started')
		await waitFor(() => toolStarted)

		let closed = false
		const closePromise = stream.return(undefined).then(result => {
			closed = true
			return result
		})
		await new Promise(resolve => setTimeout(resolve, 20))
		assert.equal(closed, false)
		releaseTool?.()
		const closeResult = await closePromise
		assert.equal(closeResult.done, true)
		assert.ok(
			pilot
				.history()
				.some(
					item => item.role === 'tool' && item.callId === 'call_close_in_flight'
				)
		)
	} finally {
		await server.close()
	}
})

test('tool argument failures and transport failures remain distinct', async () => {
	let toolExecuted = false
	const malformedServer = await createTestChatServer(
		async (_body, response, requestNumber) => {
			if (requestNumber > 1) {
				sendJson(response, {
					id: 'chatcmpl_recovered',
					choices: [
						{
							finish_reason: 'stop',
							message: { content: 'Исправлено.', role: 'assistant' }
						}
					]
				})
				return
			}

			sendJson(response, {
				id: 'chatcmpl_malformed',
				choices: [
					{
						finish_reason: 'tool_calls',
						message: {
							content: null,
							role: 'assistant',
							tool_calls: [
								{
									id: 'call_malformed',
									type: 'function',
									function: {
										arguments: '{not-json',
										name: 'inspect_safe'
									}
								}
							]
						}
					}
				]
			})
		}
	)

	try {
		const pilot = createAgentsSdkPilot({
			apiKey: 'test-router-key',
			baseUrl: malformedServer.url,
			instructions: 'Use the tool.',
			model: 'router/malformed-model',
			tools: [
				{
					...safeInspectTool,
					execute: async args => {
						toolExecuted = true
						return safeInspectTool.execute(args, {})
					}
				}
			]
		})

		const result = await pilot.run('Проверь аргументы')
		assert.equal(result.outputText, 'Исправлено.')
		assert.equal(toolExecuted, false)
		assert.equal(malformedServer.requests.length, 2)
		assert.ok(
			malformedServer.requests[1]?.messages?.some(
				message =>
					message.role === 'tool' &&
					typeof message.content === 'string' &&
					message.content.includes('parsing tool arguments')
			)
		)
	} finally {
		await malformedServer.close()
	}

	let invalidArgumentsExecuted = false
	const invalidArgumentsServer = await createTestChatServer(
		async (_body, response) => {
			sendJson(response, {
				id: 'chatcmpl_invalid_arguments',
				choices: [
					{
						finish_reason: 'tool_calls',
						message: {
							content: null,
							role: 'assistant',
							tool_calls: [
								{
									id: 'call_invalid_arguments',
									type: 'function',
									function: {
										arguments: '{"target":7,"unexpected":true}',
										name: 'inspect_safe'
									}
								}
							]
						}
					}
				]
			})
		}
	)
	try {
		const pilot = createAgentsSdkPilot({
			apiKey: 'test-router-key',
			baseUrl: invalidArgumentsServer.url,
			instructions: 'Use the tool.',
			model: 'router/invalid-arguments-model',
			tools: [
				{
					...safeInspectTool,
					execute: async args => {
						invalidArgumentsExecuted = true
						return safeInspectTool.execute(args, {})
					}
				}
			]
		})

		await assert.rejects(
			pilot.run('Проверь тип аргументов'),
			error => error instanceof AgentSdkPilotError && error.kind === 'model'
		)
		assert.equal(invalidArgumentsExecuted, false)
		assert.equal(invalidArgumentsServer.requests.length, 1)
	} finally {
		await invalidArgumentsServer.close()
	}

	const transportServer = await createTestChatServer(
		async (_body, response) => {
			response.writeHead(503, { 'content-type': 'application/json' })
			response.end(JSON.stringify({ error: 'temporarily unavailable' }))
		}
	)
	try {
		const pilot = createAgentsSdkPilot({
			apiKey: 'test-router-key',
			baseUrl: transportServer.url,
			instructions: 'Answer briefly.',
			model: 'router/transport-model'
		})
		await assert.rejects(
			pilot.run('Проверь транспорт'),
			error => error instanceof AgentSdkPilotError && error.kind === 'transport'
		)
		assert.equal(transportServer.requests.length, 1)
	} finally {
		await transportServer.close()
	}
})
