import OpenAI from 'openai'
import type { Responses } from 'openai/resources/responses/responses'

import defaultConfig from '@/config/config'

import type {
	AgentModelClient,
	AgentResponseRequest,
	CreateResponseResult,
	OpenAIResponsesSdkLike
} from '../contracts/agentClient.js'
import { mapParsedToolCalls } from './parsers.js'
import {
	buildResponsesRequestDebugMarkdown,
	writeRequestDebugDump
} from './requestDebugDump.js'

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
		this.maxOutputTokens =
			options?.maxOutputTokens ?? defaultConfig.ai.maxTokens
	}

	async createResponse(
		request: AgentResponseRequest
	): Promise<CreateResponseResult> {
		const requestBody = {
			model: this.model,
			instructions: request.instructions,
			input: request.input as unknown as Responses.ResponseInput,
			tools: request.tools,
			parallel_tool_calls: false,
			previous_response_id: request.previousResponseId ?? undefined,
			max_output_tokens: this.maxOutputTokens,
			tool_choice: 'auto' as const
		}
		const requestDumpPath = await writeRequestDebugDump({
			filePrefix: 'responses-request',
			markdown: buildResponsesRequestDebugMarkdown({
				model: requestBody.model,
				instructions: request.instructions,
				input: request.input,
				tools: request.tools,
				promptAssembly: request.promptAssembly,
				parallelToolCalls: requestBody.parallel_tool_calls,
				previousResponseId: request.previousResponseId ?? undefined,
				maxOutputTokens: requestBody.max_output_tokens,
				toolChoice: requestBody.tool_choice
			})
		})
		console.log(
			'[AI] model_request_dump',
			JSON.stringify({
				path: requestDumpPath
			})
		)

		const response = await this.client.responses.create(
			requestBody,
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
