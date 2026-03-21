import OpenAI from 'openai'
import type { Responses } from 'openai/resources/responses/responses'

import defaultConfig, { type Config as ConfigInstance } from '@config/config'
import type { AgentToolDefinition } from './tools.js'

export interface ParsedToolCall {
	callId: string
	name: string
	arguments: Record<string, unknown>
}

export interface ParsedFunctionCallOutputItem {
	type: 'function_call'
	call_id: string
	name: string
	arguments: string
	parsed_arguments?: Record<string, unknown> | null
}

export interface ParsedToolResponse {
	id: string
	output_text?: string
	output: Array<ParsedFunctionCallOutputItem | { type: string; [key: string]: unknown }>
}

export interface CreateResponseResult {
	id: string
	outputText: string
	toolCalls: ParsedToolCall[]
}

export interface AgentResponseRequest {
	instructions: string
	input: string | Array<Record<string, unknown>>
	tools: AgentToolDefinition[]
	previousResponseId?: string | null
	signal?: AbortSignal
}

export interface AgentModelClient {
	createResponse(request: AgentResponseRequest): Promise<CreateResponseResult>
}

export interface OpenAIResponsesSdkLike {
	responses: {
		create: (
			body: Responses.ResponseCreateParamsNonStreaming,
			options?: {
				timeout?: number
				signal?: AbortSignal
			}
		) => Promise<ParsedToolResponse>
	}
}

interface ChatCompletionToolCall {
	id: string
	type: 'function'
	function: {
		name: string
		arguments: string
	}
}

interface ChatCompletionMessageLike {
	content?: string | Array<{ type?: string; text?: string; [key: string]: unknown }> | null
	tool_calls?: ChatCompletionToolCall[]
}

export interface OpenAICompatibleChatSdkLike {
	chat: {
		completions: {
			create: (
				body: Record<string, unknown>,
				options?: {
					timeout?: number
					signal?: AbortSignal
				}
			) => Promise<{
				id: string
				choices: Array<{
					message: ChatCompletionMessageLike
				}>
			}>
		}
	}
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const parseArguments = (value: string, parsed?: unknown): Record<string, unknown> => {
	if (isRecord(parsed)) {
		return parsed
	}

	try {
		const normalized = JSON.parse(value) as unknown
		return isRecord(normalized) ? normalized : {}
	} catch {
		return {}
	}
}

const extractTextContent = (content: ChatCompletionMessageLike['content']): string => {
	if (typeof content === 'string') {
		return content
	}

	if (!Array.isArray(content)) {
		return ''
	}

	return content
		.map(part => (typeof part.text === 'string' ? part.text : ''))
		.join('')
		.trim()
}

export const mapParsedToolCalls = (
	response: ParsedToolResponse
): ParsedToolCall[] =>
	response.output
		.filter(
			(item): item is ParsedFunctionCallOutputItem => item.type === 'function_call'
		)
		.map(toolCall => ({
			callId: toolCall.call_id,
			name: toolCall.name,
			arguments: parseArguments(toolCall.arguments, toolCall.parsed_arguments)
		}))

const mapChatToolCalls = (toolCalls: ChatCompletionToolCall[] = []): ParsedToolCall[] =>
	toolCalls.map(toolCall => ({
		callId: toolCall.id,
		name: toolCall.function.name,
		arguments: parseArguments(toolCall.function.arguments)
	}))

const toChatTools = (tools: AgentToolDefinition[]): Array<Record<string, unknown>> =>
	tools.map(tool => ({
		type: 'function',
		function: {
			name: tool.name,
			description: tool.description,
			parameters: tool.parameters,
			strict: tool.strict
		}
	}))

const serializeChatInput = (input: Array<Record<string, unknown>>): string =>
	input.map(item => JSON.stringify(item)).join('\n')

export class OpenAIResponsesClient implements AgentModelClient {
	private readonly client: OpenAIResponsesSdkLike
	private readonly model: string
	private readonly timeoutMs: number
	private readonly maxOutputTokens: number

	constructor(options?: {
		apiKey?: string
		client?: OpenAIResponsesSdkLike
		model?: string
		timeoutMs?: number
		maxOutputTokens?: number
		baseUrl?: string
	}) {
		this.client =
			options?.client ??
			(new OpenAI({
				apiKey: options?.apiKey ?? defaultConfig.ai.apiKey,
				baseURL: options?.baseUrl ?? defaultConfig.ai.baseUrl
			}) as unknown as OpenAIResponsesSdkLike)
		this.model = options?.model ?? defaultConfig.ai.model
		this.timeoutMs = options?.timeoutMs ?? defaultConfig.ai.timeout
		this.maxOutputTokens = options?.maxOutputTokens ?? defaultConfig.ai.maxTokens
	}

	async createResponse(
		request: AgentResponseRequest
	): Promise<CreateResponseResult> {
		const response = await this.client.responses.create(
			{
				model: this.model,
				instructions: request.instructions,
				input: request.input as unknown as Responses.ResponseInput,
				tools: request.tools,
				parallel_tool_calls: false,
				previous_response_id: request.previousResponseId ?? undefined,
				max_output_tokens: this.maxOutputTokens,
				tool_choice: 'auto'
			},
			{
				timeout: this.timeoutMs,
				signal: request.signal
			}
		)

		return {
			id: response.id,
			outputText: response.output_text ?? '',
			toolCalls: mapParsedToolCalls(response)
		}
	}
}

export class OpenAICompatibleChatClient implements AgentModelClient {
	private readonly client: OpenAICompatibleChatSdkLike
	private readonly model: string
	private readonly timeoutMs: number
	private readonly maxTokens: number
	private readonly history: Array<Record<string, unknown>> = []
	private readonly pendingToolCalls = new Map<string, ChatCompletionToolCall>()
	private activeInstructions: string | null = null

	constructor(options?: {
		apiKey?: string
		client?: OpenAICompatibleChatSdkLike
		model?: string
		timeoutMs?: number
		maxOutputTokens?: number
		baseUrl?: string
	}) {
		this.client =
			options?.client ??
			(new OpenAI({
				apiKey: options?.apiKey ?? defaultConfig.ai.apiKey,
				baseURL: options?.baseUrl ?? defaultConfig.ai.baseUrl
			}) as unknown as OpenAICompatibleChatSdkLike)
		this.model = options?.model ?? defaultConfig.ai.model
		this.timeoutMs = options?.timeoutMs ?? defaultConfig.ai.timeout
		this.maxTokens = options?.maxOutputTokens ?? defaultConfig.ai.maxTokens
	}

	private ensureSession(instructions: string): void {
		if (this.activeInstructions === instructions) {
			return
		}

		this.activeInstructions = instructions
		this.history.length = 0
		this.pendingToolCalls.clear()
		this.history.push({
			role: 'system',
			content: instructions
		})
	}

	private appendInput(input: AgentResponseRequest['input']): void {
		if (typeof input === 'string') {
			this.history.push({
				role: 'user',
				content: input
			})
			return
		}

		const toolOutputs = input.filter(item => item.type === 'function_call_output')
		if (toolOutputs.length > 0) {
			for (const item of toolOutputs) {
				const callId = String(item.call_id ?? '')
				if (!callId || !this.pendingToolCalls.has(callId)) {
					continue
				}

				this.history.push({
					role: 'tool',
					tool_call_id: callId,
					content:
						typeof item.output === 'string'
							? item.output
							: JSON.stringify(item.output ?? {})
				})
				this.pendingToolCalls.delete(callId)
			}
			return
		}

		this.history.push({
			role: 'user',
			content: serializeChatInput(input)
		})
	}

	async createResponse(
		request: AgentResponseRequest
	): Promise<CreateResponseResult> {
		this.ensureSession(request.instructions)
		this.appendInput(request.input)

		const response = await this.client.chat.completions.create(
			{
				model: this.model,
				messages: this.history,
				tools: toChatTools(request.tools),
				tool_choice: 'auto',
				max_tokens: this.maxTokens,
				temperature: 0,
				stream: false
			},
			{
				timeout: this.timeoutMs,
				signal: request.signal
			}
		)

		const message = response.choices[0]?.message ?? {}
		const outputText = extractTextContent(message.content)
		const toolCalls = mapChatToolCalls(message.tool_calls)

		this.history.push({
			role: 'assistant',
			content: outputText,
			tool_calls: message.tool_calls ?? []
		})

		for (const toolCall of message.tool_calls ?? []) {
			this.pendingToolCalls.set(toolCall.id, toolCall)
		}

		return {
			id: response.id,
			outputText,
			toolCalls
		}
	}
}

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
