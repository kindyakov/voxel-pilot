import type {
	AgentModelClient,
	AgentResponseRequest,
	CreateResponseResult
} from '../contracts/agentClient.js'
import {
	AI_PILOT_UNAVAILABLE_CODE,
	AI_PILOT_UNAVAILABLE_REASON,
	type DisabledAiProvider
} from '../pilotAvailability.js'

export class AiPilotUnavailableError extends Error {
	readonly code = AI_PILOT_UNAVAILABLE_CODE

	constructor(readonly provider: DisabledAiProvider) {
		super(AI_PILOT_UNAVAILABLE_REASON)
		this.name = 'AiPilotUnavailableError'
	}
}

/** Rejects model requests without creating a network client. */
export class NoOpAgentClient implements AgentModelClient {
	constructor(private readonly provider: DisabledAiProvider) {}

	async createResponse(
		_request: AgentResponseRequest
	): Promise<CreateResponseResult> {
		throw new AiPilotUnavailableError(this.provider)
	}
}
