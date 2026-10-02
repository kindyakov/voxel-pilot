import { randomUUID } from 'node:crypto'

import {
	Agent,
	type AgentInputItem,
	type FunctionTool,
	OpenAIChatCompletionsModel,
	type RunStreamEvent,
	RunToolCallItem,
	RunToolCallOutputItem,
	Runner,
	type ToolInputParameters,
	tool
} from '@openai/agents'
import Ajv, { type AnySchema } from 'ajv'
import OpenAI from 'openai'

import { isTransportApiError } from './client/retry.js'

export interface AgentSdkToolSchema {
	type: 'object'
	properties: Record<string, Record<string, unknown>>
	required: string[]
	additionalProperties?: boolean
	description?: string
	[key: string]: unknown
}

export interface AgentSdkToolExecutionContext {
	signal?: AbortSignal
}

interface AgentSdkRunContext {
	completedToolItems: AgentInputItem[]
}

export interface AgentSdkTool {
	name: string
	description: string
	parameters: AgentSdkToolSchema
	strict?: boolean
	execute: (
		args: unknown,
		context: AgentSdkToolExecutionContext
	) => Promise<unknown> | unknown
}

export interface AgentSdkPilotOptions {
	apiKey: string
	baseUrl: string
	model: string
	instructions: string
	name?: string
	timeoutMs?: number
	maxTokens?: number
	maxTurns?: number
	tools?: readonly AgentSdkTool[]
}

export interface AgentSdkRunOptions {
	signal?: AbortSignal
	maxTurns?: number
}

export type AgentSdkEvent =
	| {
			type: 'run_started'
			runId: string
	  }
	| {
			type: 'text_delta'
			runId: string
			delta: string
	  }
	| {
			type: 'tool_call'
			runId: string
			callId: string
			name: string
			arguments: string
	  }
	| {
			type: 'tool_result'
			runId: string
			callId: string
			name: string
			output: string
	  }
	| {
			type: 'completed'
			runId: string
			outputText: string
	  }

export interface AgentSdkRunResult {
	runId: string
	outputText: string
	lastResponseId?: string
}

export type AgentSdkHistoryEntry = {
	role: 'user' | 'assistant' | 'tool' | 'system' | 'unknown'
	content: string
	callId?: string
	name?: string
}

export type AgentSdkPilotErrorKind =
	| 'aborted'
	| 'transport'
	| 'model'
	| 'unknown'

export class AgentSdkPilotError extends Error {
	readonly kind: AgentSdkPilotErrorKind
	readonly cause: unknown

	constructor(kind: AgentSdkPilotErrorKind, cause: unknown) {
		const message = cause instanceof Error ? cause.message : String(cause)
		super(message, { cause })
		this.name = 'AgentSdkPilotError'
		this.kind = kind
		this.cause = cause
	}
}

export interface AgentSdkPilot {
	run(input: string, options?: AgentSdkRunOptions): Promise<AgentSdkRunResult>
	stream(
		input: string,
		options?: AgentSdkRunOptions
	): AsyncGenerator<AgentSdkEvent>
	history(): readonly AgentSdkHistoryEntry[]
	clearHistory(): void
}

const ajv = new Ajv({ allErrors: true, strictNumbers: true })

class AgentSdkToolInputError extends Error {
	constructor(toolName: string, message: string) {
		super(`Invalid arguments for tool "${toolName}": ${message}`)
		this.name = 'AgentSdkToolInputError'
	}
}

const toToolOutput = (output: unknown): string => {
	if (typeof output === 'string') {
		return output
	}

	const serialized = JSON.stringify(output)
	return serialized === undefined ? 'null' : serialized
}

const createSdkTool = (
	definition: AgentSdkTool
): FunctionTool<AgentSdkRunContext, ToolInputParameters, string> => {
	const strict = definition.strict ?? false
	const strictParameters = {
		...definition.parameters,
		additionalProperties: false as const
	}
	const looseParameters = {
		...definition.parameters,
		additionalProperties: true as const
	}
	// The provider's non-strict contract allows open objects; Ajv still enforces the caller's schema.
	const validate = ajv.compile(definition.parameters as AnySchema)
	const execute = async (
		args: unknown,
		_context: unknown,
		details?: { signal?: AbortSignal }
	): Promise<string> => {
		if (!validate(args)) {
			throw new AgentSdkToolInputError(
				definition.name,
				ajv.errorsText(validate.errors)
			)
		}

		return toToolOutput(
			await definition.execute(args, {
				signal: details?.signal
			})
		)
	}
	const rejectToolError = (_context: unknown, error: unknown): never => {
		throw error
	}
	if (strict) {
		return tool({
			name: definition.name,
			description: definition.description,
			parameters: strictParameters,
			strict: true,
			errorFunction: rejectToolError,
			execute
		}) as unknown as FunctionTool<
			AgentSdkRunContext,
			ToolInputParameters,
			string
		>
	}

	return tool({
		name: definition.name,
		description: definition.description,
		parameters: looseParameters,
		strict: false,
		errorFunction: rejectToolError,
		execute
	}) as unknown as FunctionTool<AgentSdkRunContext, ToolInputParameters, string>
}

const textFromContent = (content: unknown): string => {
	if (typeof content === 'string') {
		return content
	}
	if (!Array.isArray(content)) {
		return ''
	}

	return content
		.map(part => {
			if (typeof part === 'string') {
				return part
			}
			if (part && typeof part === 'object' && 'text' in part) {
				const text = Reflect.get(part, 'text')
				return typeof text === 'string' ? text : ''
			}
			return ''
		})
		.join('')
}

const toDisplayOutput = (output: unknown): string => {
	if (typeof output === 'string') {
		return output
	}

	const serialized = JSON.stringify(output)
	return serialized === undefined ? '' : serialized
}

const mapHistoryItem = (item: AgentInputItem): AgentSdkHistoryEntry => {
	if (item && typeof item === 'object') {
		const record = item as Record<string, unknown>
		if (record.type === 'function_call') {
			return {
				role: 'assistant',
				content: typeof record.arguments === 'string' ? record.arguments : '',
				callId: typeof record.callId === 'string' ? record.callId : undefined,
				name: typeof record.name === 'string' ? record.name : undefined
			}
		}
		if (record.type === 'function_call_result') {
			return {
				role: 'tool',
				content: toDisplayOutput(record.output),
				callId: typeof record.callId === 'string' ? record.callId : undefined,
				name: typeof record.name === 'string' ? record.name : undefined
			}
		}
		if (typeof record.role === 'string') {
			const role =
				record.role === 'user' ||
				record.role === 'assistant' ||
				record.role === 'system'
					? record.role
					: 'unknown'
			return {
				role,
				content: textFromContent(record.content)
			}
		}
	}

	return {
		role: 'unknown',
		content: ''
	}
}

const mapStreamEvent = (
	runId: string,
	event: RunStreamEvent
): AgentSdkEvent | undefined => {
	if (event.type === 'raw_model_stream_event') {
		const data = event.data as unknown as Record<string, unknown>
		if (data.type === 'output_text_delta' && typeof data.delta === 'string') {
			return {
				type: 'text_delta',
				runId,
				delta: data.delta
			}
		}
		return undefined
	}

	if (event.type !== 'run_item_stream_event') {
		return undefined
	}

	if (event.name === 'tool_called' && event.item instanceof RunToolCallItem) {
		const rawItem = event.item.rawItem as unknown as Record<string, unknown>
		return {
			type: 'tool_call',
			runId,
			callId: event.item.callId ?? '',
			name: event.item.toolName ?? '',
			arguments: typeof rawItem.arguments === 'string' ? rawItem.arguments : ''
		}
	}
	if (
		event.name === 'tool_output' &&
		event.item instanceof RunToolCallOutputItem
	) {
		const rawItem = event.item.rawItem as unknown as Record<string, unknown>
		return {
			type: 'tool_result',
			runId,
			callId: event.item.callId ?? '',
			name: typeof rawItem.name === 'string' ? rawItem.name : '',
			output: toDisplayOutput(event.item.output)
		}
	}

	return undefined
}

const isAbortError = (error: unknown, signal?: AbortSignal): boolean => {
	if (signal?.aborted) {
		return true
	}
	if (!(error instanceof Error)) {
		return false
	}

	return (
		error.name === 'AbortError' ||
		error.name === 'APIUserAbortError' ||
		(error as Error & { code?: unknown }).code === 'ABORT_ERR'
	)
}

const isTransportError = (error: unknown): boolean => {
	return isTransportApiError(error)
}

const toPilotError = (
	error: unknown,
	signal?: AbortSignal
): AgentSdkPilotError => {
	if (isAbortError(error, signal)) {
		return new AgentSdkPilotError('aborted', error)
	}

	if (isTransportError(error)) {
		return new AgentSdkPilotError('transport', error)
	}

	if (
		error instanceof Error &&
		/model|tool|argument|schema|invalid|max.?turn|exceed/i.test(error.name)
	) {
		return new AgentSdkPilotError('model', error)
	}

	return new AgentSdkPilotError('unknown', error)
}

class AgentsSdkPilotImpl implements AgentSdkPilot {
	private readonly agent: Agent<AgentSdkRunContext>
	private readonly runner: Runner
	private readonly maxTurns: number
	private historyItems: AgentInputItem[] = []

	constructor(options: AgentSdkPilotOptions) {
		const client = new OpenAI({
			apiKey: options.apiKey,
			baseURL: options.baseUrl,
			maxRetries: 0,
			timeout: options.timeoutMs ?? 15_000
		})
		const model = new OpenAIChatCompletionsModel(client, options.model, {
			strictFeatureValidation: true
		})

		this.agent = new Agent<AgentSdkRunContext>({
			name: options.name ?? 'VoxelPilot',
			instructions: options.instructions,
			model,
			tools: (options.tools ?? []).map(createSdkTool),
			modelSettings: {
				temperature: 0,
				maxTokens: options.maxTokens,
				parallelToolCalls: false,
				retry: { maxRetries: 0 }
			}
		})
		this.agent.on('agent_tool_end', (runContext, _tool, output, details) => {
			if (!details) return
			const toolCall = details.toolCall
			if (toolCall.type !== 'function_call') return
			runContext.context.completedToolItems.push({
				type: 'function_call',
				callId: toolCall.callId,
				name: toolCall.name,
				arguments: toolCall.arguments
			})
			runContext.context.completedToolItems.push({
				type: 'function_call_result',
				name: toolCall.name,
				callId: toolCall.callId,
				status: 'completed',
				output
			})
		})
		this.runner = new Runner({ tracingDisabled: true })
		this.maxTurns = options.maxTurns ?? 8
	}

	private prepareInput(input: string): AgentInputItem[] {
		const userItem = {
			role: 'user' as const,
			content: input
		}
		return [...this.historyItems, userItem]
	}

	private outputText(output: unknown): string {
		return typeof output === 'string' ? output : toDisplayOutput(output)
	}

	async run(
		input: string,
		options: AgentSdkRunOptions = {}
	): Promise<AgentSdkRunResult> {
		const runId = randomUUID()
		const inputItems = this.prepareInput(input)
		const runContext: AgentSdkRunContext = { completedToolItems: [] }

		try {
			const result = await this.runner.run(this.agent, inputItems, {
				stream: false,
				maxTurns: options.maxTurns ?? this.maxTurns,
				signal: options.signal,
				context: runContext
			})
			this.historyItems = [...result.history]
			return {
				runId,
				outputText: this.outputText(result.finalOutput),
				lastResponseId: result.lastResponseId
			}
		} catch (error) {
			this.preservePartialHistory(
				inputItems,
				this.selectPartialHistory(
					inputItems,
					this.historyFromError(error),
					runContext.completedToolItems
				)
			)
			throw toPilotError(error, options.signal)
		}
	}

	async *stream(
		input: string,
		options: AgentSdkRunOptions = {}
	): AsyncGenerator<AgentSdkEvent> {
		const runId = randomUUID()
		const inputItems = this.prepareInput(input)
		const runContext: AgentSdkRunContext = { completedToolItems: [] }
		const runController = new AbortController()
		const forwardAbort = () => {
			runController.abort(options.signal?.reason)
		}
		options.signal?.addEventListener('abort', forwardAbort, { once: true })
		if (options.signal?.aborted) {
			forwardAbort()
		}
		let result: Awaited<ReturnType<Runner['run']>> | undefined

		try {
			const streamedResult = await this.runner.run(this.agent, inputItems, {
				stream: true,
				maxTurns: options.maxTurns ?? this.maxTurns,
				signal: runController.signal,
				context: runContext
			})
			result = streamedResult as unknown as Awaited<ReturnType<Runner['run']>>
			yield { type: 'run_started', runId }

			for await (const event of streamedResult) {
				const mapped = mapStreamEvent(runId, event)
				if (mapped) {
					yield mapped
				}
			}
			await streamedResult.completed
			if (streamedResult.cancelled || runController.signal.aborted) {
				throw new Error('Agent request aborted')
			}
			this.historyItems = [...streamedResult.history]
			yield {
				type: 'completed',
				runId,
				outputText: this.outputText(streamedResult.finalOutput)
			}
		} catch (error) {
			this.preservePartialHistory(
				inputItems,
				this.selectPartialHistory(
					inputItems,
					result?.history,
					runContext.completedToolItems
				)
			)
			throw toPilotError(error, options.signal ?? runController.signal)
		} finally {
			if (!runController.signal.aborted) {
				runController.abort()
			}
			if (result) {
				try {
					await result.completed
				} catch {
					// Preserve the original stream error and use the state accumulated before cancellation.
				}
				this.preservePartialHistory(
					inputItems,
					this.selectPartialHistory(
						inputItems,
						result.history,
						runContext.completedToolItems
					)
				)
			}
			options.signal?.removeEventListener('abort', forwardAbort)
		}
	}

	private preservePartialHistory(
		inputItems: AgentInputItem[],
		partialHistory: readonly AgentInputItem[] | undefined
	): void {
		this.historyItems =
			partialHistory && partialHistory.length >= inputItems.length
				? [...partialHistory]
				: [...inputItems]
	}

	private historyFromError(error: unknown): AgentInputItem[] | undefined {
		let current: unknown = error
		for (let depth = 0; depth < 3; depth += 1) {
			if (current === null || typeof current !== 'object') {
				return undefined
			}

			const state = Reflect.get(current, 'state')
			if (state && typeof state === 'object') {
				try {
					const history = Reflect.get(state, 'history')
					if (Array.isArray(history)) {
						return history as AgentInputItem[]
					}
				} catch {
					// A provider error may expose a state object that is no longer readable.
				}
			}

			current = Reflect.get(current, 'cause')
		}

		return undefined
	}

	private selectPartialHistory(
		inputItems: AgentInputItem[],
		stateHistory: AgentInputItem[] | undefined,
		completedToolItems: readonly AgentInputItem[]
	): AgentInputItem[] {
		const journalHistory = [...inputItems, ...completedToolItems]
		return stateHistory && stateHistory.length >= journalHistory.length
			? stateHistory
			: journalHistory
	}

	history(): readonly AgentSdkHistoryEntry[] {
		return this.historyItems.map(mapHistoryItem)
	}

	clearHistory(): void {
		this.historyItems = []
	}
}

export const createAgentsSdkPilot = (
	options: AgentSdkPilotOptions
): AgentSdkPilot => new AgentsSdkPilotImpl(options)
