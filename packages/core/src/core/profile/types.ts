export interface UserProfilePrompt {
	persona: string | null
	style: string | null
	defaultLanguage: string | null
	selfDescription: string | null
	tone: string | null
	behaviorPreferences: string[]
}

export interface ProfileMemoryStoreOptions {
	botName: string
	dataDir?: string
}

const normalizeString = (value: string | null | undefined): string | null => {
	if (typeof value !== 'string') {
		return null
	}

	const trimmed = value.trim()
	return trimmed.length > 0 ? trimmed : null
}

export const createEmptyUserProfilePrompt = (): UserProfilePrompt => ({
	persona: null,
	style: null,
	defaultLanguage: null,
	selfDescription: null,
	tone: null,
	behaviorPreferences: []
})

export const normalizeUserProfilePrompt = (
	value: Partial<UserProfilePrompt> | null | undefined
): UserProfilePrompt => ({
	persona: normalizeString(value?.persona),
	style: normalizeString(value?.style),
	defaultLanguage: normalizeString(value?.defaultLanguage),
	selfDescription: normalizeString(value?.selfDescription),
	tone: normalizeString(value?.tone),
	behaviorPreferences: Array.isArray(value?.behaviorPreferences)
		? Array.from(
				new Set(
					value.behaviorPreferences
						.map(item => (typeof item === 'string' ? item.trim() : ''))
						.filter(Boolean)
				)
			)
		: []
})
