import type { ConversationEntry } from '@/ai/conversationHistory.js'
import type { WindowSession } from '@/ai/runtime/window.js'
import type { TaskContext } from '@/ai/taskContext.js'

import type { Bot } from '@/types'

import type { MemoryManager } from '@/core/memory/index.js'
import type { UserProfilePrompt } from '@/core/profile/index.js'

import type { AgentModelClient } from './agentClient.js'
import type { PendingExecution } from './execution.js'

export interface AgentTurnInput {
	bot: Bot
	memory: MemoryManager
	currentGoal: string
	subGoal: string | null
	conversationHistory?: ConversationEntry[]
	userProfilePrompt?: UserProfilePrompt | null
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
