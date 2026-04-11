import type { Responses } from 'openai/resources/responses/responses'

import type { AgentPromptAssembly } from '@/ai/prompt.js'

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
	output: Array<
		ParsedFunctionCallOutputItem | { type: string; [key: string]: unknown }
	>
}

export interface CreateResponseResult {
	id: string
	outputText: string
	toolCalls: ParsedToolCall[]
}

export type AgentToolDefinition = Responses.FunctionTool

export interface AgentResponseRequest {
	instructions: string
	input: string | Array<Record<string, unknown>>
	tools: AgentToolDefinition[]
	promptAssembly?: AgentPromptAssembly
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

export interface ChatCompletionToolCall {
	id: string
	type: 'function'
	function: {
		name: string
		arguments: string
	}
}

export interface ChatCompletionMessageLike {
	content?:
		| string
		| Array<{ type?: string; text?: string; [key: string]: unknown }>
		| null
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
				choices?: Array<{
					message: ChatCompletionMessageLike
				}>
			}>
		}
	}
}
