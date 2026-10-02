import type { Bot } from '@/types/index.js'

import type { MemoryManager } from '@/core/memory/index.js'
import type { UserProfilePrompt } from '@/core/profile/index.js'

import type { ConversationEntry } from '@/ai/conversationHistory.js'
import type { WindowRuntime } from '@/ai/runtime/window.js'
import type { TaskContext } from '@/ai/taskContext.js'

import type { AgentModelClient } from './agentClient.js'
import type { PendingExecution } from './execution.js'

/** Confirmed mining outcomes for the current goal, not current inventory stock. */
export interface CompletedMiningTask {
	taskId: string | null
	blockName: string
	resourceName: string
	requested: number
	collected: number
}

export interface AgentTurnInput {
	bot: Bot
	memory: MemoryManager
	currentGoal: string
	subGoal: string | null
	conversationHistory?: ConversationEntry[]
	userProfilePrompt?: UserProfilePrompt | null
	lastAction: string | null
	lastActionArgs?: Record<string, unknown> | null
	completedMiningTasks?: readonly CompletedMiningTask[]
	lastResult: 'SUCCESS' | 'FAILED' | null
	lastReason: string | null
	errorHistory: string[]
	taskContext: TaskContext
	windows?: WindowRuntime
	signal?: AbortSignal
	client?: AgentModelClient
}

export type AgentTurnResult =
	| { kind: 'rejected'; reason: string; transcript: string[] }
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
			/** Maps to `transport_failed`: pause the goal without consuming its budget. */
			isTransport?: boolean
	  }
