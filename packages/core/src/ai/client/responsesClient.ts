import type { Responses } from 'openai/resources/responses/responses'

import type {
	AgentClientOptions,
	AgentModelClient,
	AgentResponseRequest,
	CreateResponseResult,
	OpenAIResponsesSdkLike
} from '../contracts/agentClient.js'
import { createOpenAISdk } from './openaiSdk.js'
import { mapParsedToolCalls } from './parsers.js'
import {
	buildResponsesRequestDebugMarkdown,
	writeRequestDebugDump
} from './requestDebugDump.js'
import { withApiRetry } from './retry.js'

export class OpenAIResponsesClient implements AgentModelClient {
	private readonly client: OpenAIResponsesSdkLike
	private readonly model: string
	private readonly timeoutMs: number
	private readonly maxOutputTokens: number

	private readonly logger: AgentClientOptions['logger']
	private readonly debugDump: AgentClientOptions['debugDump']

	constructor(
		options: AgentClientOptions & { client?: OpenAIResponsesSdkLike }
	) {
		this.client =
			options.client ??
			(createOpenAISdk(options) as unknown as OpenAIResponsesSdkLike)
		this.model = options.model
		this.timeoutMs = options.timeoutMs
		this.maxOutputTokens = options.maxOutputTokens
		this.logger = options.logger
		this.debugDump = Object.freeze({ ...options.debugDump })
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
		if (this.debugDump.enabled) {
			const requestDumpPath = await writeRequestDebugDump({
				directory: this.debugDump.directory,
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
			this.logger.debug('[AI] model_request_dump', {
				path: requestDumpPath
			})
		}

		const response = await withApiRetry(
			() =>
				this.client.responses.create(requestBody, {
					timeout: this.timeoutMs,
					signal: request.signal
				}),
			{ signal: request.signal }
		)

		return {
			id: response.id,
			outputText: response.output_text ?? '',
			toolCalls: mapParsedToolCalls(response)
		}
	}
}
