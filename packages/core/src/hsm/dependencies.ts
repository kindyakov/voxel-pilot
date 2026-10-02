import type { RuntimeLogger } from '@/config/runtimeLogger.js'

import type { AgentTurnRunner } from '@/ai/contracts/agentTurn.js'

export type { AgentTurnRunner } from '@/ai/contracts/agentTurn.js'

export interface HarnessDependencies {
	readonly logger: RuntimeLogger
	readonly runAgentTurn: AgentTurnRunner
	readonly aiPilotEnabled: boolean
	readonly minecraftVersion: string
	readonly diagnosticsEnabled: boolean
}
