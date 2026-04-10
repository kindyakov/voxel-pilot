import type { Bot } from '@/types'

import type { MemoryManager } from '@/core/memory/index.js'
import type { WindowSession } from '@/ai/runtime/window.js'

import {
	appendRejectedStepSignature,
	type TaskContext
} from './taskContext.js'
import { type AgentModelClient, createAgentClient } from './client.js'
import { buildSnapshot } from './snapshot.js'
import {
	AGENT_SYSTEM_PROMPT,
	AGENT_TOOLS,
	type InlineToolName,
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
	activeWindowSession?: WindowSession | null
	activeWindowSessionState?: 'open' | 'close_failed' | null
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

type GroundedPositionCapability =
	| 'navigate_to'
	| 'break_block'
	| 'open_window'
	| 'place_block'
type GroundedEntitySource = 'inspect_entities'
type GroundedReferenceIndex<TSource extends string> = Map<string, Set<TSource>>

type GroundedTurnFacts = {
	positionCapabilities: GroundedReferenceIndex<GroundedPositionCapability>
	entityNames: GroundedReferenceIndex<GroundedEntitySource>
	entityTypes: GroundedReferenceIndex<GroundedEntitySource>
	entityNameTypePairs: Set<string>
}

const createGroundedTurnFacts = (): GroundedTurnFacts => ({
	positionCapabilities: new Map<string, Set<GroundedPositionCapability>>(),
	entityNames: new Map<string, Set<GroundedEntitySource>>(),
	entityTypes: new Map<string, Set<GroundedEntitySource>>(),
	entityNameTypePairs: new Set<string>()
})

const addGroundedReference = <TSource extends string>(
	index: GroundedReferenceIndex<TSource>,
	value: string,
	source: TSource
): boolean => {
	const existingSources = index.get(value)
	if (existingSources) {
		const sizeBefore = existingSources.size
		existingSources.add(source)
		return existingSources.size > sizeBefore
	}

	index.set(value, new Set([source]))
	return true
}

const hasGroundedReferences = (facts: GroundedTurnFacts): boolean =>
	facts.positionCapabilities.size > 0 ||
	facts.entityNames.size > 0 ||
	facts.entityTypes.size > 0

const isRecord = (value: unknown): value is Record<string, unknown> =>
	Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const normalizeFactValue = (value: unknown): string | null => {
	if (typeof value !== 'string') {
		return null
	}

	const normalized = value.trim().toLowerCase()
	return normalized.length > 0 ? normalized : null
}

const entityNameTypePairKey = (name: string, type: string): string =>
	`${name}\u0000${type}`

const tryParsePosition = (
	value: unknown
): { x: number; y: number; z: number } | null => {
	if (!isRecord(value)) {
		return null
	}

	const x = Number(value.x)
	const y = Number(value.y)
	const z = Number(value.z)
	if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
		return null
	}

	return { x, y, z }
}

const positionKey = (position: { x: number; y: number; z: number }): string =>
	`${position.x}:${position.y}:${position.z}`

const addPositionCapability = (
	facts: GroundedTurnFacts,
	position: { x: number; y: number; z: number },
	capability: GroundedPositionCapability
): boolean =>
	addGroundedReference(
		facts.positionCapabilities,
		positionKey(position),
		capability
	)

const hasPositionCapability = (
	facts: GroundedTurnFacts,
	position: { x: number; y: number; z: number },
	capability: GroundedPositionCapability
): boolean =>
	Boolean(
		facts.positionCapabilities.get(positionKey(position))?.has(capability)
	)

const hasAnyPositionCapability = (
	facts: GroundedTurnFacts,
	position: { x: number; y: number; z: number }
): boolean => Boolean(facts.positionCapabilities.get(positionKey(position)))

const WINDOW_MEMORY_KEYWORDS = [
	'container',
	'window',
	'chest',
	'barrel',
	'shulker',
	'furnace',
	'smoker',
	'blast_furnace',
	'blast furnace',
	'crafting_table',
	'crafting table',
	'hopper',
	'dropper',
	'dispenser'
]

const hasWindowKeyword = (value: string): boolean =>
	WINDOW_MEMORY_KEYWORDS.some(keyword => value.includes(keyword))

const isWindowCompatibleMemoryEntry = (
	entry: Record<string, unknown>
): boolean => {
	const type = normalizeFactValue(entry.type)
	if (type !== 'container' && type !== 'location') {
		return false
	}

	if (type === 'container') {
		return true
	}

	const tags = Array.isArray(entry.tags)
		? entry.tags
				.map(normalizeFactValue)
				.filter((tag): tag is string => Boolean(tag))
		: []
	const description = normalizeFactValue(entry.description)
	const data = isRecord(entry.data) ? entry.data : null
	const dataHints = [
		normalizeFactValue(data?.interactable),
		normalizeFactValue(data?.kind),
		normalizeFactValue(data?.blockName),
		normalizeFactValue(data?.block_name),
		normalizeFactValue(data?.containerType),
		normalizeFactValue(data?.container_type),
		normalizeFactValue(data?.name)
	].filter((hint): hint is string => Boolean(hint))

	return [...tags, ...(description ? [description] : []), ...dataHints].some(
		hasWindowKeyword
	)
}

const collectGroundedFacts = (
	name: InlineToolName,
	output: Record<string, unknown>,
	facts: GroundedTurnFacts
): number => {
	let added = 0

	switch (name) {
		case 'memory_read': {
			const entries = Array.isArray(output.entries) ? output.entries : []
			for (const entry of entries) {
				const record = isRecord(entry) ? entry : null
				if (!record) {
					continue
				}
				const position = tryParsePosition(
					record.position
				)
				if (position) {
					added += addPositionCapability(
						facts,
						position,
						'navigate_to'
					)
						? 1
						: 0
					added += addPositionCapability(
						facts,
						position,
						'place_block'
					)
						? 1
						: 0
					added +=
						isWindowCompatibleMemoryEntry(record) &&
						addPositionCapability(facts, position, 'open_window')
						? 1
						: 0
				}
			}
			return added
		}
		case 'inspect_blocks': {
			const blocks = Array.isArray(output.blocks) ? output.blocks : []
			for (const block of blocks) {
				const record = isRecord(block) ? block : null
				if (!record) {
					continue
				}
				const position = tryParsePosition(
					record.position
				)
				if (position) {
					added += addPositionCapability(
						facts,
						position,
						'navigate_to'
					)
						? 1
						: 0
					added += addPositionCapability(
						facts,
						position,
						'break_block'
					)
						? 1
						: 0
					added += addPositionCapability(
						facts,
						position,
						'place_block'
					)
						? 1
						: 0
					added +=
						normalizeFactValue(record.kind) === 'interactable' &&
						addPositionCapability(facts, position, 'open_window')
						? 1
						: 0
				}
			}
			return added
		}
		case 'inspect_entities': {
			const entities = Array.isArray(output.entities) ? output.entities : []
			for (const entity of entities) {
				const record = isRecord(entity) ? entity : null
				const label = normalizeFactValue(record?.label)
				if (label) {
					added += addGroundedReference(
						facts.entityNames,
						label,
						'inspect_entities'
					)
						? 1
						: 0
				}
				const type = normalizeFactValue(record?.type)
				if (type) {
					added += addGroundedReference(
						facts.entityTypes,
						type,
						'inspect_entities'
					)
						? 1
						: 0
				}
				if (label && type) {
					const pairKey = entityNameTypePairKey(label, type)
					if (!facts.entityNameTypePairs.has(pairKey)) {
						facts.entityNameTypePairs.add(pairKey)
						added += 1
					}
				}
			}
			return added
		}
		case 'inspect_window': {
			const window = isRecord(output.window) ? output.window : null
			const position = tryParsePosition(window?.position)
			if (position) {
				added += addPositionCapability(
					facts,
					position,
					'navigate_to'
				)
					? 1
					: 0
				added += addPositionCapability(
					facts,
					position,
					'place_block'
				)
					? 1
					: 0
				added += addPositionCapability(
					facts,
					position,
					'open_window'
				)
					? 1
					: 0
			}
			return added
		}
		default:
			return 0
	}
}

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
	taskContext: TaskContext,
	groundedFacts: GroundedTurnFacts
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
		execution.toolName === 'navigate_to'
	) {
		const blockName = getNavigateBlockName(bot, execution.args)
		if (blockName === 'stonecutter') {
			return 'Navigate target points to an unsupported workstation for crafting tasks'
		}
	}

	const targetPosition = tryParsePosition(execution.args.position)
	const hasGroundedPosition =
		targetPosition !== null &&
		hasAnyPositionCapability(groundedFacts, targetPosition)

	switch (execution.toolName) {
		case 'navigate_to':
			if (!hasGroundedPosition) {
				return 'Execution tool "navigate_to" requires any grounded target position in this turn'
			}
			return null
		case 'break_block':
			if (
				!targetPosition ||
				!hasPositionCapability(
					groundedFacts,
					targetPosition,
					'break_block'
				)
			) {
				return 'Execution tool "break_block" requires a block position grounded by inspect_blocks in this turn'
			}
			return null
		case 'mine_resource': {
			const blockName = normalizeFactValue(execution.args.block_name)
			const count = execution.args.count
			if (!blockName) {
				return 'Execution tool "mine_resource" requires block_name'
			}
			if (
				typeof count !== 'number' ||
				!Number.isFinite(count) ||
				!Number.isInteger(count) ||
				count <= 0 ||
				count > 64
			) {
				return 'Execution tool "mine_resource" requires an integer count from 1 to 64'
			}
			return null
		}
		case 'open_window':
			if (
				!targetPosition ||
				!hasPositionCapability(
					groundedFacts,
					targetPosition,
					'open_window'
				)
			) {
				return 'Execution tool "open_window" requires a window-compatible position grounded by inspect_blocks(interactable), inspect_window, or container/location memory_read in this turn'
			}
			return null
		case 'place_block':
			if (
				!targetPosition ||
				!hasPositionCapability(
					groundedFacts,
					targetPosition,
					'place_block'
				)
			) {
				return 'Execution tool "place_block" requires a grounded target position from memory_read/inspect_blocks/inspect_window in this turn'
			}
			return null
		case 'follow_entity': {
			const requestedName = normalizeFactValue(execution.args.entity_name)
			const requestedType = normalizeFactValue(execution.args.entity_type)
			if (!requestedName && !requestedType) {
				return 'Execution tool "follow_entity" requires entity_name or entity_type grounded by inspect_entities in this turn'
			}
			if (
				requestedName &&
				requestedType &&
				!groundedFacts.entityNameTypePairs.has(
					entityNameTypePairKey(requestedName, requestedType)
				)
			) {
				return `Execution tool "follow_entity" requires entity_name "${String(execution.args.entity_name)}" and entity_type "${String(execution.args.entity_type)}" to refer to the same grounded entity fact from inspect_entities in this turn`
			}
			if (
				requestedName &&
				!groundedFacts.entityNames.has(requestedName)
			) {
				return `Execution tool "follow_entity" requested entity_name "${String(execution.args.entity_name)}" that is not grounded by inspect_entities in this turn`
			}
			if (
				requestedType &&
				!groundedFacts.entityTypes.has(requestedType)
			) {
				return `Execution tool "follow_entity" requested entity_type "${String(execution.args.entity_type)}" that is not grounded by inspect_entities in this turn`
			}
			return null
		}
		case 'transfer_item':
		case 'close_window':
			return null
		default:
			return null
	}
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
		lastResult: input.lastResult,
		lastReason: input.lastReason,
		errorHistory: input.errorHistory,
		activeWindowSession: input.activeWindowSession ?? null,
		activeWindowSessionState: input.activeWindowSessionState ?? null
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
	const groundedFacts = createGroundedTurnFacts()

	// debug: turn_start

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
		// debug: round_complete

		if (response.toolCalls.length === 0) {
			const plainTextOutput =
				typeof response.outputText === 'string'
					? response.outputText.trim()
					: ''
			if (plainTextOutput && hasGroundedReferences(groundedFacts)) {
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
			// debug: tool_call

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
			// debug: tool_result
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
