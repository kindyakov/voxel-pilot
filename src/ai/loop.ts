import type { Bot } from '@/types'

import type { MemoryManager } from '@/core/memory/index.js'

import {
	appendRejectedStepSignature,
	type TaskContext
} from './taskContext.js'
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
	taskContext: TaskContext
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

const toLogString = (value: unknown, maxLength: number = 240): string => {
	try {
		const raw =
			typeof value === 'string' ? value : JSON.stringify(value ?? null)
		return raw.length > maxLength
			? `${raw.slice(0, maxLength - 3)}...`
			: raw
	} catch {
		return String(value)
	}
}

const executionSignature = (toolName: string, args: Record<string, unknown>) =>
	`${toolName}:${JSON.stringify(args)}`

const getNavigateBlockName = (
	bot: Bot,
	args: Record<string, unknown>
): string | null => {
	const position = args.position
	if (
		!position ||
		typeof position !== 'object' ||
		Array.isArray(position) ||
		typeof (position as Record<string, unknown>).x !== 'number' ||
		typeof (position as Record<string, unknown>).y !== 'number' ||
		typeof (position as Record<string, unknown>).z !== 'number'
	) {
		return null
	}

	const block = bot.blockAt(position as { x: number; y: number; z: number })
	return block?.name ?? null
}

const validateInlineTool = (
	name: string,
	args: Record<string, unknown>,
	taskContext: TaskContext
): string | null => {
	if (name !== 'memory_save') {
		return null
	}

	if (taskContext.category !== 'craft') {
		return null
	}

	const tags = Array.isArray(args.tags) ? args.tags.map(String) : []
	const description = String(args.description ?? '').toLowerCase()
	const interactable = String(
		(args.data as Record<string, unknown> | undefined)?.interactable ?? ''
	).toLowerCase()
	const values = [...tags.map(tag => tag.toLowerCase()), description, interactable]

	if (values.some(value => value.includes('stonecutter'))) {
		return 'Unsupported workstation memory save is not relevant to crafting runtime'
	}

	return null
}

const validateExecutionTool = (
	bot: Bot,
	execution: PendingExecution,
	taskContext: TaskContext
): string | null => {
	if (
		taskContext.rejectedStepSignatures.includes(
			executionSignature(execution.toolName, execution.args)
		)
	) {
		return 'Execution step was already rejected as irrelevant for the current task'
	}

	if (
		taskContext.category === 'craft' &&
		execution.toolName === 'call_navigate'
	) {
		const blockName = getNavigateBlockName(bot, execution.args)
		if (blockName === 'stonecutter') {
			return 'Navigate target points to an unsupported workstation for crafting tasks'
		}
	}

	return null
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
		taskContext: input.taskContext,
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

	console.log(
		'[AI] turn_start',
		JSON.stringify({
			goal: input.currentGoal,
			subGoal: input.subGoal,
			lastAction: input.lastAction,
			lastResult: input.lastResult,
			lastReason: input.lastReason
		})
	)

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
		console.log(
			'[AI] round_complete',
			JSON.stringify({
				round,
				responseId: response.id,
				durationMs: duration,
				toolCalls: response.toolCalls.map(toolCall => toolCall.name),
				outputText: response.outputText
					? toLogString(response.outputText, 160)
					: ''
			})
		)

		if (response.toolCalls.length === 0) {
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
			console.log(
				'[AI] tool_call',
				JSON.stringify({
					round,
					name: toolCall.name,
					args: toolCall.arguments
				})
			)

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
					input.taskContext
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
					bot: input.bot
				}
			)
			console.log(
				'[AI] tool_result',
				JSON.stringify({
					round,
					name: toolCall.name,
					ok: result.ok,
					output: toLogString(result.output)
				})
			)
			inlineOutputs.push({
				type: 'function_call_output',
				call_id: toolCall.callId,
				output: JSON.stringify(result.output)
			})
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
