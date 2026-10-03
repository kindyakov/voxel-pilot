import type { AIConfig } from '@/config/runtimeConfig.js'

/** Shared instance credential policy; text formatting/caps belong to each caller. */
export function createSecretRedactor(
	ai: Pick<AIConfig, 'apiKey' | 'baseUrl'>
): (text: string) => string {
	const secrets = new Set<string>()
	const remember = (value: string) => {
		if (!value) return
		secrets.add(value)
		try {
			secrets.add(decodeURIComponent(value))
		} catch {
			// Keep malformed escapes as their original exact known value.
		}
	}
	if (ai.apiKey) remember(ai.apiKey)
	let origin: string | undefined
	let invalidEndpoint: string | undefined
	if (ai.baseUrl) {
		try {
			const url = new URL(ai.baseUrl)
			origin = url.origin
			remember(url.username)
			remember(url.password)
			for (const value of url.searchParams.values()) remember(value)
			remember(url.hash.slice(1))
		} catch {
			invalidEndpoint = ai.baseUrl
		}
	}
	const forms = new Set(secrets)
	for (const secret of secrets) {
		try {
			forms.add(encodeURIComponent(secret))
		} catch {
			// Malformed surrogate credentials still have their exact form removed.
		}
		forms.add(new URLSearchParams({ value: secret }).toString().slice(6))
	}
	// Percent-escape hex is case-insensitive; credential text itself is not.
	const patterns = [...forms]
		.sort((a, b) => b.length - a.length)
		.map(value => {
			const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
			return new RegExp(
				escaped.replace(/%[\da-f]{2}/gi, escape =>
					escape.replace(
						/[a-f]/gi,
						hex => `[${hex.toLowerCase()}${hex.toUpperCase()}]`
					)
				),
				'g'
			)
		})
	return text => {
		if (invalidEndpoint) text = text.split(invalidEndpoint).join('<REDACTED>')
		if (origin) {
			text = text.replace(/https?:\/\/[^\s<>"']+/g, candidate => {
				try {
					const url = new URL(candidate)
					if (url.origin !== origin) return candidate
					url.username = ''
					url.password = ''
					url.search = ''
					url.hash = ''
					return url.toString()
				} catch {
					return candidate
				}
			})
		}
		for (const pattern of patterns) text = text.replace(pattern, '<REDACTED>')
		return text
	}
}
