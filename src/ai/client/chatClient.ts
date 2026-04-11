import OpenAI from 'openai'

import defaultConfig from '@/config/config'

import type {
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
			max_tokens: this.maxTokens,
			temperature: 0,
			stream: false
		}
		const requestDumpPath = await writeRequestDebugDump({
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
		console.log(
			'[AI] model_request_dump',
			JSON.stringify({
				path: requestDumpPath
			})
		)

		const response = await this.client.chat.completions.create(
			requestBody,
			{
				timeout: this.timeoutMs,
				signal: request.signal
			}
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
