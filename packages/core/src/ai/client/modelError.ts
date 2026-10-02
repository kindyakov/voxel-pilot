import type { AIConfig } from '@/config/runtimeConfig.js'

/** Keep provider credentials out of returned failures and runtime log records. */
export function summarizeModelError(error: unknown, ai: AIConfig): string {
	let message = error instanceof Error ? error.message : String(error)
	const secrets = new Set<string>()
	if (ai.apiKey) secrets.add(ai.apiKey)
	if (ai.baseUrl) {
		try {
			const url = new URL(ai.baseUrl)
			for (const value of [
				url.username,
				url.password,
				...url.searchParams.values()
			]) {
				if (value) {
					secrets.add(value)
					try {
						secrets.add(decodeURIComponent(value))
					} catch {
						// An invalid escape still has its original exact value redacted.
					}
				}
			}
			url.username = ''
			url.password = ''
			url.search = ''
			url.hash = ''
			message = message.split(ai.baseUrl).join(url.toString())
		} catch {
			// Unvalidated injected configuration must not expose its URL.
			message = message.split(ai.baseUrl).join('<REDACTED>')
		}
	}
	for (const secret of [...secrets].sort((a, b) => b.length - a.length)) {
		message = message.split(secret).join('<REDACTED>')
	}
	return message
}
