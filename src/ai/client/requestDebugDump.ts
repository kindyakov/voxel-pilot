import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

import type { AgentPromptAssembly } from '@/ai/prompt.js'

import type { AgentToolDefinition } from '../contracts/agentClient.js'

const REQUEST_DEBUG_DIR = path.resolve(process.cwd(), 'logs', 'ai-requests')

type DebugSection = {
	title: string
	format: 'json' | 'text'
	content: unknown
}

const formatJson = (value: unknown): string => JSON.stringify(value, null, 2)

const renderSection = ({ title, format, content }: DebugSection): string => {
	const body = format === 'json' ? formatJson(content) : String(content)
	return [`## ${title}`, '', `\`\`\`${format}`, body, '```'].join('\n')
}

export const buildRequestDebugMarkdown = (params: {
	title: string
	body: unknown
	sections: DebugSection[]
}): string =>
	[
		`# ${params.title}`,
		'',
		renderSection({
			title: 'Request Body',
			format: 'json',
			content: params.body
		}),
		'',
		...params.sections.flatMap(section => [renderSection(section), ''])
	].join('\n')

const buildToolsSection = (tools: AgentToolDefinition[]): string =>
	tools.length === 0
		? 'No tools.'
		: tools
				.map(tool => {
					const header =
						typeof tool.name === 'string' ? `### \`${tool.name}\`` : '### Tool'
					const description =
						typeof tool.description === 'string' ? tool.description : '-'
					return [
						header,
						'',
						description,
						'',
						'```json',
						formatJson(tool),
						'```'
					].join('\n')
				})
				.join('\n\n')

const buildPromptAssemblySections = (
	promptAssembly: AgentPromptAssembly | undefined,
	fallbacks: {
		instructions: string
		input: string | Array<Record<string, unknown>>
		tools: AgentToolDefinition[]
	}
): DebugSection[] => {
	if (!promptAssembly) {
		return [
			{
				title: 'Instructions',
				format: 'text',
				content: fallbacks.instructions
			},
			{
				title: 'Input',
				format: typeof fallbacks.input === 'string' ? 'text' : 'json',
				content: fallbacks.input
			},
			{
				title: 'Tools',
				format: 'text',
				content: buildToolsSection(fallbacks.tools)
			}
		]
	}

	const corePolicy =
		promptAssembly.instructionSections.find(
			section => section.source === 'core_policy'
		)?.content ?? '-'
	const userProfilePrompt =
		promptAssembly.instructionSections.find(
			section => section.source === 'user_profile_prompt'
		)?.content ?? '-'
	const runtimeContext =
		promptAssembly.inputSections.find(
			section =>
				section.source === 'runtime_context' &&
				section.key === 'runtime_context'
		)?.content ?? '-'
	const conversationContext =
		promptAssembly.inputSections.find(
			section => section.source === 'conversation_context'
		)?.content ?? '-'

	return [
		{
			title: 'Core Policy',
			format: 'text',
			content: corePolicy
		},
		{
			title: 'User Profile Prompt',
			format: 'text',
			content: userProfilePrompt
		},
		{
			title: 'Runtime Context',
			format: 'text',
			content: runtimeContext
		},
		{
			title: 'Conversation Context',
			format: 'text',
			content: conversationContext
		},
		{
			title: 'Tool Contract',
			format: 'text',
			content: buildToolsSection(promptAssembly.toolContract.tools)
		}
	]
}

export const buildResponsesRequestDebugMarkdown = (payload: {
	model: string
	instructions: string
	input: string | Array<Record<string, unknown>>
	tools: AgentToolDefinition[]
	promptAssembly?: AgentPromptAssembly
	parallelToolCalls: boolean
	previousResponseId?: string
	maxOutputTokens: number
	toolChoice: 'auto'
}): string => {
	const requestBody = {
		model: payload.model,
		instructions: payload.instructions,
		input: payload.input,
		tools: payload.tools,
		parallel_tool_calls: payload.parallelToolCalls,
		previous_response_id: payload.previousResponseId,
		max_output_tokens: payload.maxOutputTokens,
		tool_choice: payload.toolChoice
	}

	return buildRequestDebugMarkdown({
		title: 'AI Responses Request Dump',
		body: requestBody,
		sections: buildPromptAssemblySections(payload.promptAssembly, {
			instructions: payload.instructions,
			input: payload.input,
			tools: payload.tools
		})
	})
}

export const buildChatRequestDebugMarkdown = (payload: {
	model: string
	messages: Array<Record<string, unknown>>
	tools: AgentToolDefinition[]
	toolChoice: 'auto'
	maxTokens: number
	temperature: number
	stream: boolean
	systemPrompt: string
	promptAssembly?: AgentPromptAssembly
}): string => {
	const requestBody = {
		model: payload.model,
		messages: payload.messages,
		tools: payload.tools,
		tool_choice: payload.toolChoice,
		max_tokens: payload.maxTokens,
		temperature: payload.temperature,
		stream: payload.stream
	}

	return buildRequestDebugMarkdown({
		title: 'AI Chat Request Dump',
		body: requestBody,
		sections: [
			...buildPromptAssemblySections(payload.promptAssembly, {
				instructions: payload.systemPrompt,
				input: payload.messages,
				tools: payload.tools
			}),
			{
				title: 'Messages',
				format: 'json',
				content: payload.messages
			}
		]
	})
}

export const writeRequestDebugDump = async (params: {
	filePrefix: 'responses-request' | 'chat-request'
	markdown: string
}): Promise<string> => {
	await mkdir(REQUEST_DEBUG_DIR, { recursive: true })

	const fileName = `${params.filePrefix}-${new Date()
		.toISOString()
		.replace(/[:.]/g, '-')}.md`
	const filePath = path.join(REQUEST_DEBUG_DIR, fileName)
	await writeFile(filePath, params.markdown, 'utf8')
	return filePath
}
