const MAX_CONVERSATION_HISTORY = 6

export type ConversationRole = 'user' | 'assistant'

export interface ConversationEntry {
	role: ConversationRole
	message: string
	username?: string
}

const normalizeMessage = (message: string): string => message.trim()

export const trimConversationHistory = (
	history: ConversationEntry[]
): ConversationEntry[] => history.slice(-MAX_CONVERSATION_HISTORY)

export const appendConversationEntry = (
	history: ConversationEntry[],
	entry: ConversationEntry
): ConversationEntry[] => {
	const message = normalizeMessage(entry.message)
	if (!message) {
		return history
	}

	return trimConversationHistory([
		...history,
		{
			...entry,
			message
		}
	])
}
