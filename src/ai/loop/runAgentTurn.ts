import { createAgentClient } from '@/ai/client.js'
import { assembleAgentPrompt } from '@/ai/prompt.js'
import { appendRejectedStepSignature } from '@/ai/taskContext.js'
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
import {
	collectGroundedFacts,
	createGroundedTurnFacts
} from './grounding.js'
import {
	MAX_INLINE_TOOL_ROUNDS,
	MAX_MODEL_RETRIES,
	parseSubGoal
} from './policy.js'
import { executionSignature } from './transcript.js'
import { validateExecutionTool, validateInlineTool } from './validation.js'

export const runAgentTurn = async (
	input: AgentTurnInput
): Promise<AgentTurnResult> => {
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
		activeWindowSession: input.activeWindowSession ?? null,
		activeWindowSessionState: input.activeWindowSessionState ?? null,
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
		const response = await client.createResponse({
			instructions: promptAssembly.instructions,
			input: nextInput,
			tools: AGENT_TOOLS,
			promptAssembly,
			previousResponseId,
			signal: input.signal
		})
		const duration = Date.now() - roundStart
		transcript.push(`round_${round}_ms:${duration}`)

		if (response.toolCalls.length === 0) {
			const plainTextOutput =
				typeof response.outputText === 'string'
					? response.outputText.trim()
					: ''
			if (plainTextOutput) {
				console.log(
					'[AI] plain_text_fallback_finish',
					JSON.stringify({
						round,
						responseId: response.id,
						message: plainTextOutput
					})
				)
				const result: AgentTurnResult = {
					kind: 'finish',
					message: plainTextOutput,
					transcript
				}
				console.log(
					'[AI] turn_finish',
					JSON.stringify({
						kind: result.kind,
						message: result.message,
						transcript
					})
				)
				return result
			}

			if (modelRetries < MAX_MODEL_RETRIES) {
				console.log(
					'[AI] retry_no_tool_call',
					JSON.stringify({
						round,
						responseId: response.id,
						retry: modelRetries + 1
					})
				)
				modelRetries += 1
				previousResponseId = response.id
				nextInput =
					'Return exactly one tool call. Do not answer with plain text.'
				continue
			}

			console.log(
				'[AI] turn_failed',
				JSON.stringify({
					reason: 'Model did not return a tool call',
					transcript
				})
			)
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
					console.log(
						'[AI] turn_failed',
						JSON.stringify({
							reason:
								'Model mixed execution and informational tools in one response',
							transcript
						})
					)
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
				const executionValidationError = validateExecutionTool(
					input.bot,
					execution,
					input.taskContext,
					groundedFacts
				)
				if (executionValidationError) {
					console.log(
						'[AI] turn_failed',
						JSON.stringify({
							reason: executionValidationError,
							transcript
						})
					)
					input.taskContext = appendRejectedStepSignature(
						input.taskContext,
						executionSignature(execution.toolName, execution.args)
					)
					return {
						kind: 'failed',
						reason: executionValidationError,
						transcript
					}
				}
				console.log(
					'[AI] execution_selected',
					JSON.stringify({
						round,
						toolName: execution.toolName,
						args: execution.args
					})
				)
				continue
			}

			if (isControlToolName(toolCall.name)) {
				if (execution || sawInlineTool || finishMessage) {
					console.log(
						'[AI] turn_failed',
						JSON.stringify({
							reason: 'Model returned conflicting terminal actions',
							transcript
						})
					)
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
				console.log(
					'[AI] finish_selected',
					JSON.stringify({
						round,
						message: finishMessage
					})
				)
				continue
			}

			if (!isInlineToolName(toolCall.name)) {
				console.log(
					'[AI] turn_failed',
					JSON.stringify({
						reason: `Unknown tool requested: ${toolCall.name}`,
						transcript
					})
				)
				return {
					kind: 'failed',
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
				console.log(
					'[AI] turn_failed',
					JSON.stringify({
						reason: inlineValidationError,
						transcript
					})
				)
				return {
					kind: 'failed',
					reason: inlineValidationError,
					transcript
				}
			}

			sawInlineTool = true
			const result = await executeInlineToolCall(
				toolCall.name,
				toolCall.arguments,
				{
					bot: input.bot,
					activeWindowSession: input.activeWindowSession ?? null,
					activeWindowSessionState: input.activeWindowSessionState ?? null
				}
			)
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
			console.log(
				'[AI] turn_finish',
				JSON.stringify({
					kind: result.kind,
					toolName: result.execution.toolName,
					args: result.execution.args,
					subGoal: result.subGoal,
					transcript
				})
			)
			return result
		}

		if (finishMessage) {
			const result: AgentTurnResult = {
				kind: 'finish',
				message: finishMessage,
				transcript
			}
			console.log(
				'[AI] turn_finish',
				JSON.stringify({
					kind: result.kind,
					message: result.message,
					transcript
				})
			)
			return result
		}

		if (inlineOutputs.length === 0) {
			console.log(
				'[AI] turn_failed',
				JSON.stringify({
					reason: 'Model requested no actionable tool output',
					transcript
				})
			)
			return {
				kind: 'failed',
				reason: 'Model requested no actionable tool output',
				transcript
			}
		}

		previousResponseId = response.id
		nextInput = inlineOutputs
	}

	console.log(
		'[AI] turn_failed',
		JSON.stringify({
			reason: 'Inline tool round limit exceeded',
			transcript
		})
	)
	return {
		kind: 'failed',
		reason: 'Inline tool round limit exceeded',
		transcript
	}
}
