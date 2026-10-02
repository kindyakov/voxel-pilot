export const MAX_INLINE_TOOL_ROUNDS = 4
export const MAX_MODEL_RETRIES = 1

export const parseSubGoal = (text: string, fallback: string): string => {
	const normalized = text.trim()
	return normalized || fallback
}
