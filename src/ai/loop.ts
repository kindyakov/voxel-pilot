import type { Bot } from '@types'

import type { MemoryManager } from '@core/memory/index.js'

import { type AgentModelClient, createAgentClient } from './client.js'
import { buildSnapshot } from './snapshot.js'
import {
	AGENT_SYSTEM_PROMPT,
	AGENT_TOOLS,
	type PendingExecution,
	executeInlineToolCall,
	isControlToolName,
	isExecutionToolName,
	isInlineToolName,
	summarizeExecution
} from './tools.js'

interface AgentTurnInput {
	bot: Bot
	memory: MemoryManager
	currentGoal: string
	subGoal: string | null
	lastAction: string | null
	lastResult: 'SUCCESS' | 'FAILED' | null
	lastReason: string | null
	errorHistory: string[]
	signal?: AbortSignal
	client?: AgentModelClient
}

export type AgentTurnResult =
	| {
			kind: 'execute'
			execution: PendingExecution
			subGoal: string
			transcript: string[]
	  }
	| {
			kind: 'finish'
			message: string
			transcript: string[]
	  }
	| {
			kind: 'failed'
			reason: string
			transcript: string[]
	  }

const MAX_INLINE_TOOL_ROUNDS = 4
const MAX_MODEL_RETRIES = 1

const parseSubGoal = (text: string, fallback: string): string => {
	const normalized = text.trim()
	return normalized || fallback
}

export const runAgentTurn = async (
	input: AgentTurnInput
): Promise<AgentTurnResult> => {
	const client = input.client ?? createAgentClient()
	const transcript: string[] = []
	const snapshot = buildSnapshot({
		bot: input.bot,
		currentGoal: input.currentGoal,
		subGoal: input.subGoal,
		lastAction: input.lastAction,
		actionResult: input.lastResult,
		reason: input.lastReason,
		errorHistory: input.errorHistory
	})

	let previousResponseId: string | null = null
	let nextInput: string | Array<Record<string, unknown>> = [
		'Current goal:',
		input.currentGoal,
		'',
		'Snapshot:',
		snapshot
	].join('\n')
	let modelRetries = 0

	for (let round = 0; round < MAX_INLINE_TOOL_ROUNDS; round += 1) {
		if (input.signal?.aborted) {
			throw new Error('Agent thinking aborted')
		}

		const roundStart = Date.now()
		const response = await client.createResponse({
			instructions: AGENT_SYSTEM_PROMPT,
			input: nextInput,
			tools: AGENT_TOOLS,
			previousResponseId,
			signal: input.signal
		})
		const duration = Date.now() - roundStart
		transcript.push(`round_${round}_ms:${duration}`)

		if (response.toolCalls.length === 0) {
			if (modelRetries < MAX_MODEL_RETRIES) {
				modelRetries += 1
				previousResponseId = response.id
				nextInput =
					'Return exactly one tool call. Do not answer with plain text.'
				continue
			}

			return {
				kind: 'failed',
				reason: 'Model did not return a tool call',
				transcript
			}
		}

		const inlineOutputs: Array<Record<string, unknown>> = []
		let execution: PendingExecution | null = null
		let finishMessage: string | null = null
		let sawInlineTool = false

		for (const toolCall of response.toolCalls) {
			transcript.push(toolCall.name)

			if (isExecutionToolName(toolCall.name)) {
				if (execution || sawInlineTool || finishMessage) {
					return {
						kind: 'failed',
						reason:
							'Model mixed execution and informational tools in one response',
						transcript
					}
				}

				execution = {
					toolName: toolCall.name,
					args: toolCall.arguments
				}
				continue
			}

			if (isControlToolName(toolCall.name)) {
				if (execution || sawInlineTool || finishMessage) {
					return {
						kind: 'failed',
						reason: 'Model returned conflicting terminal actions',
						transcript
					}
				}

				finishMessage =
					typeof toolCall.arguments.message === 'string'
						? toolCall.arguments.message
						: typeof toolCall.arguments.summary === 'string'
							? toolCall.arguments.summary
							: response.outputText || 'Goal finished'
				continue
			}

			if (!isInlineToolName(toolCall.name)) {
				return {
					kind: 'failed',
					reason: `Unknown tool requested: ${toolCall.name}`,
					transcript
				}
			}

			sawInlineTool = true
			const result = await executeInlineToolCall(
				toolCall.name,
				toolCall.arguments,
				{
					bot: input.bot
				}
			)
			inlineOutputs.push({
				type: 'function_call_output',
				call_id: toolCall.callId,
				output: JSON.stringify(result.output)
			})
		}

		if (execution) {
			return {
				kind: 'execute',
				execution,
				subGoal: parseSubGoal(
					response.outputText,
					summarizeExecution(execution)
				),
				transcript
			}
		}

		if (finishMessage) {
			return {
				kind: 'finish',
				message: finishMessage,
				transcript
			}
		}

		if (inlineOutputs.length === 0) {
			return {
				kind: 'failed',
				reason: 'Model requested no actionable tool output',
				transcript
			}
		}

		previousResponseId = response.id
		nextInput = inlineOutputs
	}

	return {
		kind: 'failed',
		reason: 'Inline tool round limit exceeded',
		transcript
	}
}
