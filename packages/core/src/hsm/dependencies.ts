import type { RuntimeLogger } from '@/config/runtimeLogger.js'

import type {
	AgentTurnInput,
	AgentTurnResult
} from '@/ai/contracts/agentTurn.js'

// Structurally identical to #24's canonical type; consolidated when branches merge.
export type AgentTurnRunner = (
	input: AgentTurnInput
) => Promise<AgentTurnResult>

export interface HarnessDependencies {
	readonly logger: RuntimeLogger
	readonly runAgentTurn: AgentTurnRunner
	readonly aiPilotEnabled: boolean
	readonly minecraftVersion: string
	readonly diagnosticsEnabled: boolean
}
