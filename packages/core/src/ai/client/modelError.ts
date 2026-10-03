import { createSecretRedactor } from '@/config/credentialRedactor.js'
import type { AIConfig } from '@/config/runtimeConfig.js'

/** Keep provider credentials out of returned failures and runtime log records. */
export function summarizeModelError(error: unknown, ai: AIConfig): string {
	const message = error instanceof Error ? error.message : String(error)
	return createSecretRedactor(ai)(message)
}
