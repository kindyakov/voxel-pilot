import type {
	AgentToolDefinition,
	ChatCompletionMessageLike,
	ChatCompletionToolCall,
	ParsedFunctionCallOutputItem,
	ParsedToolCall,
	ParsedToolResponse
} from '../contracts/agentClient.js'

const isRecord = (value: unknown): value is Record<string, unknown> =>
	Boolean(value) && typeof value === 'object' && !Array.isArray(value)

export const parseArguments = (
	value: string,
	parsed?: unknown
): Record<string, unknown> => {
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

export const extractTextContent = (
	content: ChatCompletionMessageLike['content']
): string => {
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
			(item): item is ParsedFunctionCallOutputItem =>
				item.type === 'function_call'
		)
		.map(toolCall => ({
			callId: toolCall.call_id,
			name: toolCall.name,
			arguments: parseArguments(toolCall.arguments, toolCall.parsed_arguments)
		}))

export const mapChatToolCalls = (
	toolCalls: ChatCompletionToolCall[] = []
): ParsedToolCall[] =>
	toolCalls.map(toolCall => ({
		callId: toolCall.id,
		name: toolCall.function.name,
		arguments: parseArguments(toolCall.function.arguments)
	}))

export const toChatTools = (
	tools: AgentToolDefinition[]
): Array<Record<string, unknown>> =>
	tools.map(tool => ({
		type: 'function',
		function: {
			name: tool.name,
			description: tool.description,
			parameters: tool.parameters,
			strict: tool.strict
		}
	}))

export const serializeChatInput = (
	input: Array<Record<string, unknown>>
): string => input.map(item => JSON.stringify(item)).join('\n')

export const getFirstChatChoiceMessage = (response: {
	choices?: Array<{ message: ChatCompletionMessageLike }>
}): ChatCompletionMessageLike => {
	if (!Array.isArray(response.choices) || response.choices.length === 0) {
		return {}
	}

	return response.choices[0]?.message ?? {}
}
