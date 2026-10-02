export const AI_PILOT_UNAVAILABLE_CODE = 'AI_PILOT_UNAVAILABLE'
export const AI_PILOT_UNAVAILABLE_REASON = 'AI pilot is unavailable'
export const AI_PILOT_UNAVAILABLE_COMMAND_MESSAGE = `${AI_PILOT_UNAVAILABLE_REASON}; use :stop`

export type DisabledAiProvider = 'disabled' | 'local'

export const isAiPilotDisabled = (
	provider: string
): provider is DisabledAiProvider =>
	provider === 'disabled' || provider === 'local'
