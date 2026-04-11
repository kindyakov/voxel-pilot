import type { Bot } from '@/types'

import type { PendingExecution } from '../contracts/execution.js'
import type { TaskContext } from '../taskContext.js'
import {
	type GroundedTurnFacts,
	entityNameTypePairKey,
	hasAnyPositionCapability,
	hasPositionCapability,
	normalizeFactValue,
	tryParsePosition
} from './grounding.js'
import { executionSignature } from './transcript.js'

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

export const validateInlineTool = (
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
	const values = [
		...tags.map(tag => tag.toLowerCase()),
		description,
		interactable
	]

	if (values.some(value => value.includes('stonecutter'))) {
		return 'Unsupported workstation memory save is not relevant to crafting runtime'
	}

	return null
}

export const validateExecutionTool = (
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
				!hasPositionCapability(groundedFacts, targetPosition, 'break_block')
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
				!hasPositionCapability(groundedFacts, targetPosition, 'open_window')
			) {
				return 'Execution tool "open_window" requires a window-compatible position grounded by inspect_blocks(interactable), inspect_window, or container/location memory_read in this turn'
			}
			return null
		case 'place_block':
			if (
				!targetPosition ||
				!hasPositionCapability(groundedFacts, targetPosition, 'place_block')
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
			if (requestedName && !groundedFacts.entityNames.has(requestedName)) {
				return `Execution tool "follow_entity" requested entity_name "${String(execution.args.entity_name)}" that is not grounded by inspect_entities in this turn`
			}
			if (requestedType && !groundedFacts.entityTypes.has(requestedType)) {
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
