import OpenAI from 'openai'

import type {
	AgentClientOptions,
	AgentModelClient,
	AgentResponseRequest,
	ChatCompletionToolCall,
	CreateResponseResult,
	OpenAICompatibleChatSdkLike
} from '../contracts/agentClient.js'
import {
	extractTextContent,
	getFirstChatChoiceMessage,
	mapChatToolCalls,
	serializeChatInput,
	toChatTools
} from './parsers.js'
import {
	buildChatRequestDebugMarkdown,
	writeRequestDebugDump
} from './requestDebugDump.js'
import { withApiRetry } from './retry.js'

export class OpenAICompatibleChatClient implements AgentModelClient {
	private readonly client: OpenAICompatibleChatSdkLike
	private readonly model: string
	private readonly timeoutMs: number
	private readonly maxTokens: number
	private readonly history: Array<Record<string, unknown>> = []
	private readonly pendingToolCalls = new Map<string, ChatCompletionToolCall>()
	private activeInstructions: string | null = null

	private readonly logger: AgentClientOptions['logger']
	private readonly debugDump: AgentClientOptions['debugDump']

	constructor(
		options: AgentClientOptions & { client?: OpenAICompatibleChatSdkLike }
	) {
		if (!options.client && !options.apiKey?.trim()) {
			throw new Error('Explicit AI API key is required')
		}
		this.client =
			options.client ??
			(new OpenAI({
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
			}) as unknown as OpenAICompatibleChatSdkLike)
		this.model = options.model
		this.timeoutMs = options.timeoutMs
		this.maxTokens = options.maxOutputTokens
		this.logger = options.logger
		this.debugDump = Object.freeze({ ...options.debugDump })
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

		const toolOutputs = input.filter(
			item => item.type === 'function_call_output'
		)
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

		const requestBody = {
			model: this.model,
			messages: this.history,
			tools: toChatTools(request.tools),
			tool_choice: 'auto' as const,
			parallel_tool_calls: false,
			max_tokens: this.maxTokens,
			temperature: 0,
			stream: false
		}
		if (this.debugDump.enabled) {
			const requestDumpPath = await writeRequestDebugDump({
				directory: this.debugDump.directory,
				filePrefix: 'chat-request',
				markdown: buildChatRequestDebugMarkdown({
					model: requestBody.model,
					messages: this.history,
					tools: request.tools,
					toolChoice: requestBody.tool_choice,
					maxTokens: requestBody.max_tokens,
					temperature: requestBody.temperature,
					stream: requestBody.stream,
					systemPrompt: request.instructions,
					promptAssembly: request.promptAssembly
				})
			})
			this.logger.debug('[AI] model_request_dump', {
				path: requestDumpPath
			})
		}

		const response = await withApiRetry(
			() =>
				this.client.chat.completions.create(requestBody, {
					timeout: this.timeoutMs,
					signal: request.signal
				}),
			{ signal: request.signal }
		)

		const message = getFirstChatChoiceMessage(response)
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
