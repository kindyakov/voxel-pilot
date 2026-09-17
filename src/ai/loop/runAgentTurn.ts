import Logger from '@/config/logger.js'

import { createAgentClient } from '@/ai/client.js'
import { isTransportApiError } from '@/ai/client/retry.js'
import { assembleAgentPrompt } from '@/ai/prompt.js'
import {
	AGENT_TOOLS,
	executeInlineToolCall,
	isControlToolName,
	isExecutionToolName,
	isInlineToolName,
	summarizeExecution
} from '@/ai/tools.js'

import type { AgentTurnInput, AgentTurnResult } from '../contracts/agentTurn.js'
import type { PendingExecution } from '../contracts/execution.js'
import { getWindowRuntime } from '../runtime/window.js'
import { parseExecution } from '../tools/executionDefinitions.js'
import {
	collectGroundedFacts,
	createGroundedTurnFacts,
	hasGroundedReferences
} from './grounding.js'
import {
	MAX_INLINE_TOOL_ROUNDS,
	MAX_MODEL_RETRIES,
	parseSubGoal
} from './policy.js'
import { validateExecutionTool, validateInlineTool } from './validation.js'

export const runAgentTurn = async (
	input: AgentTurnInput
): Promise<AgentTurnResult> => {
	const windows = input.windows ?? getWindowRuntime(input.bot)
	const windowState = windows.getSnapshot()
	const client = input.client ?? createAgentClient()
	const transcript: string[] = []
	const promptAssembly = assembleAgentPrompt({
		bot: input.bot,
		currentGoal: input.currentGoal,
		subGoal: input.subGoal,
		conversationHistory: input.conversationHistory ?? [],
		userProfilePrompt: input.userProfilePrompt ?? null,
		lastAction: input.lastAction,
		lastResult: input.lastResult,
		lastReason: input.lastReason,
		errorHistory: input.errorHistory,
		activeWindowSession: windowState.session,
		activeWindowSessionState: windowState.state,
		tools: AGENT_TOOLS
	})

	let previousResponseId: string | null = null
	let nextInput: string | Array<Record<string, unknown>> = promptAssembly.input
	let modelRetries = 0
	const groundedFacts = createGroundedTurnFacts()

	for (let round = 0; round < MAX_INLINE_TOOL_ROUNDS; round += 1) {
		if (input.signal?.aborted) {
			throw new Error('Agent thinking aborted')
		}

		const roundStart = Date.now()
		let response
		try {
			response = await client.createResponse({
				instructions: promptAssembly.instructions,
				input: nextInput,
				tools: AGENT_TOOLS,
				promptAssembly,
				previousResponseId,
				signal: input.signal
			})
		} catch (error) {
			if (input.signal?.aborted) {
				throw error
			}

			const reason = error instanceof Error ? error.message : String(error)
			Logger.info('[AI] turn_failed', {
				reason: `Model request failed: ${reason}`,
				transcript
			})
			return {
				kind: 'failed',
				reason: `Model request failed: ${reason}`,
				transcript,
				isTransport: isTransportApiError(error)
			}
		}
		input.signal?.throwIfAborted()
		const duration = Date.now() - roundStart
		transcript.push(`round_${round}_ms:${duration}`)

		if (response.toolCalls.length === 0) {
			const plainTextOutput =
				typeof response.outputText === 'string'
					? response.outputText.trim()
					: ''
			if (plainTextOutput && hasGroundedReferences(groundedFacts)) {
				Logger.debug('[AI] plain_text_fallback_finish', {
					round,
					responseId: response.id,
					message: plainTextOutput
				})
				const result: AgentTurnResult = {
					kind: 'finish',
					message: plainTextOutput,
					transcript
				}
				Logger.info('[AI] turn_finish', {
					kind: result.kind,
					message: result.message,
					transcript
				})
				return result
			}

			if (plainTextOutput) {
				Logger.info('[AI] turn_failed', {
					reason: 'Model returned plain text without grounded inspect data',
					transcript
				})
				return {
					kind: 'rejected',
					reason: 'Model returned plain text without grounded inspect data',
					transcript
				}
			}

			if (modelRetries < MAX_MODEL_RETRIES) {
				Logger.debug('[AI] retry_no_tool_call', {
					round,
					responseId: response.id,
					retry: modelRetries + 1
				})
				modelRetries += 1
				previousResponseId = response.id
				nextInput =
					'Return exactly one tool call. Do not answer with plain text.'
				continue
			}

			Logger.info('[AI] turn_failed', {
				reason: 'Model did not return a tool call',
				transcript
			})
			return {
				kind: 'rejected',
				reason: 'Model did not return a tool call',
				transcript
			}
		}

		if (
			response.toolCalls.length > 1 &&
			response.toolCalls.some(
				call => isExecutionToolName(call.name) || isControlToolName(call.name)
			)
		) {
			return {
				kind: 'rejected',
				reason:
					'Model mixed execution, control or informational tools in one response',
				transcript
			}
		}

		const inlineOutputs: Array<Record<string, unknown>> = []
		let execution: PendingExecution | null = null
		let finishMessage: string | null = null

		for (const toolCall of response.toolCalls) {
			transcript.push(toolCall.name)

			if (isExecutionToolName(toolCall.name)) {
				const parsed = parseExecution(toolCall.name, toolCall.arguments)
				if (!parsed.ok)
					return { kind: 'rejected', reason: parsed.reason, transcript }
				execution = parsed.execution
				const executionValidationError = validateExecutionTool(
					input.bot,
					execution,
					input.taskContext,
					groundedFacts
				)
				if (executionValidationError) {
					Logger.info('[AI] turn_failed', {
						reason: executionValidationError,
						transcript
					})
					return {
						kind: 'rejected',
						reason: executionValidationError,
						transcript
					}
				}
				Logger.debug('[AI] execution_selected', {
					round,
					toolName: execution.toolName,
					args: execution.args
				})
				continue
			}

			if (isControlToolName(toolCall.name)) {
				finishMessage =
					typeof toolCall.arguments.message === 'string'
						? toolCall.arguments.message
						: typeof toolCall.arguments.summary === 'string'
							? toolCall.arguments.summary
							: response.outputText || 'Goal finished'
				Logger.debug('[AI] finish_selected', {
					round,
					message: finishMessage
				})
				continue
			}

			if (!isInlineToolName(toolCall.name)) {
				Logger.info('[AI] turn_failed', {
					reason: `Unknown tool requested: ${toolCall.name}`,
					transcript
				})
				return {
					kind: 'rejected',
					reason: `Unknown tool requested: ${toolCall.name}`,
					transcript
				}
			}

			const inlineValidationError = validateInlineTool(
				toolCall.name,
				toolCall.arguments,
				input.taskContext
			)
			if (inlineValidationError) {
				Logger.info('[AI] turn_failed', {
					reason: inlineValidationError,
					transcript
				})
				return {
					kind: 'rejected',
					reason: inlineValidationError,
					transcript
				}
			}

			let result
			try {
				result = await executeInlineToolCall(
					toolCall.name,
					toolCall.arguments,
					{
						bot: input.bot,
						windows,
						signal: input.signal
					}
				)
			} catch (error) {
				input.signal?.throwIfAborted()
				const reason = error instanceof Error ? error.message : String(error)
				Logger.info('[AI] turn_failed', {
					reason: `Inline tool "${toolCall.name}" threw: ${reason}`,
					transcript
				})
				return {
					kind: 'failed',
					reason: `Inline tool "${toolCall.name}" threw: ${reason}`,
					transcript,
					isTransport: false
				}
			}
			input.signal?.throwIfAborted()
			inlineOutputs.push({
				type: 'function_call_output',
				call_id: toolCall.callId,
				output: JSON.stringify(result.output)
			})
			if (result.ok) {
				collectGroundedFacts(toolCall.name, result.output, groundedFacts)
			}
		}

		if (execution) {
			const result: AgentTurnResult = {
				kind: 'execute',
				execution,
				subGoal: parseSubGoal(
					response.outputText,
					summarizeExecution(execution)
				),
				transcript
			}
			Logger.info('[AI] turn_finish', {
				kind: result.kind,
				toolName: result.execution.toolName,
				args: result.execution.args,
				subGoal: result.subGoal,
				transcript
			})
			return result
		}

		if (finishMessage) {
			const result: AgentTurnResult = {
				kind: 'finish',
				message: finishMessage,
				transcript
			}
			Logger.info('[AI] turn_finish', {
				kind: result.kind,
				message: result.message,
				transcript
			})
			return result
		}

		if (inlineOutputs.length === 0) {
			Logger.info('[AI] turn_failed', {
				reason: 'Model requested no actionable tool output',
				transcript
			})
			return {
				kind: 'rejected',
				reason: 'Model requested no actionable tool output',
				transcript
			}
		}

		previousResponseId = response.id
		nextInput = inlineOutputs
	}

	Logger.info('[AI] turn_failed', {
		reason: 'Inline tool round limit exceeded',
		transcript
	})
	return {
		kind: 'rejected',
		reason: 'Inline tool round limit exceeded',
		transcript
	}
}
