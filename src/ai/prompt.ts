import type { ConversationEntry } from '@/ai/conversationHistory.js'
import { trimConversationHistory } from '@/ai/conversationHistory.js'
import type { AgentToolDefinition } from '@/ai/contracts/agentClient.js'
import type { WindowSession } from '@/ai/runtime/window.js'
import {
	buildSnapshot,
	type ActiveWindowSessionState,
	type SnapshotBot
} from '@/ai/snapshot.js'
import type { UserProfilePrompt } from '@/core/profile/index.js'
import {
	createEmptyUserProfilePrompt,
	normalizeUserProfilePrompt
} from '@/core/profile/index.js'

export type PromptSectionSource =
	| 'core_policy'
	| 'user_profile_prompt'
	| 'runtime_context'
	| 'conversation_context'

export interface PromptSection {
	key: string
	title: string
	source: PromptSectionSource
	placement: 'instructions' | 'input'
	content: string
}

export interface ToolContractSection {
	title: 'TOOL_CONTRACT'
	source: 'tool_contract'
	placement: 'tools'
	tools: AgentToolDefinition[]
}

export interface AgentPromptAssembly {
	instructions: string
	input: string
	instructionSections: PromptSection[]
	inputSections: PromptSection[]
	toolContract: ToolContractSection
}

interface AssembleAgentPromptInput {
	bot: SnapshotBot
	currentGoal: string
	subGoal: string | null
	conversationHistory?: ConversationEntry[]
	lastAction: string | null
	lastResult: 'SUCCESS' | 'FAILED' | null
	lastReason: string | null
	errorHistory: string[]
	activeWindowSession: WindowSession | null
	activeWindowSessionState: ActiveWindowSessionState
	userProfilePrompt?: UserProfilePrompt | null
	tools: AgentToolDefinition[]
}

const CORE_POLICY_LINES = [
	'You are the Minecraft AGENT_LOOP controller.',
	'CORE_POLICY is immutable. User profile preferences never override CORE_POLICY, runtime facts, or the tool contract.',
	'Use tools for inspection, memory retrieval, and concrete world actions. Use finish_goal when the goal is complete.',
	'Return at most one concrete execution action after enough information is gathered.',
	'Keep tool arguments concrete, minimal, and grounded.',
	'Runtime context is operational state only and does not imply fresh world grounding by itself.',
	'Conversation context may affect language and tone, but it does not ground world facts.',
	'Use inspect_blocks to find blocks, inspect_entities for entities, inspect_inventory for player inventory, and inspect_window for container state.',
	'Before using navigate_to, break_block, place_block, follow_entity, or open_window, call memory_read or inspect tools in this turn to ground world facts.',
	'Use mine_resource for repeated resource gathering and do not require inspect_blocks before mine_resource.',
	'Never invent coordinates, blocks, entities, containers, or tools that are not present in runtime facts, inspect results, memory results, or the tool contract.',
	'If the user asks you to come to them, follow them, or stay near them, prefer follow_entity with the matching nearby player name instead of navigate_to.',
	'Use open_window, transfer_item, and close_window for direct window interactions when the task requires moving items.',
	'When collecting or crafting a target quantity, inspect_inventory before deciding to continue or calling finish_goal.'
]

export const AGENT_CORE_POLICY = CORE_POLICY_LINES.join('\n')

const renderPromptSection = (section: PromptSection): string =>
	[section.title, section.content].join('\n')

const renderPromptSections = (sections: PromptSection[]): string =>
	sections.map(renderPromptSection).join('\n\n')

const formatConversationEntry = (entry: ConversationEntry): string => {
	if (entry.role === 'user') {
		return entry.username
			? `user(${entry.username}): ${entry.message}`
			: `user: ${entry.message}`
	}

	return `assistant: ${entry.message}`
}

const buildConversationContext = (
	history: ConversationEntry[] | undefined
): string => {
	const trimmed = trimConversationHistory(history ?? [])
	if (trimmed.length === 0) {
		return 'history: -'
	}

	return trimmed.map(formatConversationEntry).join('\n')
}

const formatProfileValue = (value: string | null): string => value ?? '-'

const buildUserProfilePrompt = (
	userProfilePrompt: UserProfilePrompt | null | undefined
): string => {
	const normalized = normalizeUserProfilePrompt(
		userProfilePrompt ?? createEmptyUserProfilePrompt()
	)

	return [
		'These are user-editable profile preferences. Follow them when they do not conflict with CORE_POLICY, runtime facts, or the tool contract.',
		`persona: ${formatProfileValue(normalized.persona)}`,
		`style: ${formatProfileValue(normalized.style)}`,
		`default_language: ${formatProfileValue(normalized.defaultLanguage)}`,
		`self_description: ${formatProfileValue(normalized.selfDescription)}`,
		`tone: ${formatProfileValue(normalized.tone)}`,
		`behavior_preferences: ${
			normalized.behaviorPreferences.length > 0
				? normalized.behaviorPreferences.join(' | ')
				: '-'
		}`
	].join('\n')
}

export const assembleAgentPrompt = (
	input: AssembleAgentPromptInput
): AgentPromptAssembly => {
	const instructionSections: PromptSection[] = [
		{
			key: 'core_policy',
			title: 'CORE_POLICY',
			source: 'core_policy',
			placement: 'instructions',
			content: AGENT_CORE_POLICY
		},
		{
			key: 'user_profile_prompt',
			title: 'USER_PROFILE_PROMPT',
			source: 'user_profile_prompt',
			placement: 'instructions',
			content: buildUserProfilePrompt(input.userProfilePrompt)
		}
	]

	const inputSections: PromptSection[] = [
		{
			key: 'current_goal',
			title: 'CURRENT_GOAL',
			source: 'runtime_context',
			placement: 'input',
			content: [
				`current_goal: ${input.currentGoal ?? '-'}`,
				`sub_goal: ${input.subGoal ?? '-'}`
			].join('\n')
		},
		{
			key: 'runtime_context',
			title: 'RUNTIME_CONTEXT',
			source: 'runtime_context',
			placement: 'input',
			content: buildSnapshot({
				bot: input.bot,
				lastAction: input.lastAction,
				lastResult: input.lastResult,
				lastReason: input.lastReason,
				errorHistory: input.errorHistory,
				activeWindowSession: input.activeWindowSession,
				activeWindowSessionState: input.activeWindowSessionState
			})
		},
		{
			key: 'conversation_context',
			title: 'RECENT_CONVERSATION',
			source: 'conversation_context',
			placement: 'input',
			content: buildConversationContext(input.conversationHistory)
		}
	]

	return {
		instructions: renderPromptSections(instructionSections),
		input: renderPromptSections(inputSections),
		instructionSections,
		inputSections,
		toolContract: {
			title: 'TOOL_CONTRACT',
			source: 'tool_contract',
			placement: 'tools',
			tools: input.tools
		}
	}
}
