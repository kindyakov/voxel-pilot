import { AI_PILOT_UNAVAILABLE_CODE } from '../pilotAvailability.js'

export interface ApiRetryOptions {
	maxAttempts?: number
	baseDelayMs?: number
	signal?: AbortSignal
}

const DEFAULT_MAX_ATTEMPTS = 3
const DEFAULT_BASE_DELAY_MS = 1000

const RETRYABLE_STATUS_CODES = new Set([408, 409, 425, 429, 500, 502, 503, 504])

const RETRYABLE_ERROR_CODES = new Set([
	'ECONNREFUSED',
	'ECONNRESET',
	'ECONNABORTED',
	'ETIMEDOUT',
	'EAI_AGAIN',
	'ENOTFOUND',
	'EPIPE'
])

const RETRYABLE_ERROR_NAMES = new Set([
	'APIConnectionError',
	'APIConnectionTimeoutError',
	'InternalServerError',
	'RateLimitError',
	'BadGatewayError',
	'ServiceUnavailableError',
	'GatewayTimeoutError'
])

export type ApiErrorKind = 'abort' | 'transport' | 'other'

export interface ApiErrorClassification {
	kind: ApiErrorKind
	retryable: boolean
}

const getErrorProperty = (error: unknown, key: string): unknown =>
	error !== null && (typeof error === 'object' || typeof error === 'function')
		? Reflect.get(error, key)
		: undefined

const getStringProperty = (error: unknown, key: string): string | null => {
	const value = getErrorProperty(error, key)
	return typeof value === 'string' ? value : null
}

export const classifyApiError = (error: unknown): ApiErrorClassification => {
	const name = getStringProperty(error, 'name')
	const directCode = getStringProperty(error, 'code')
	if (name === 'AbortError' || directCode === 'ABORT_ERR') {
		return { kind: 'abort', retryable: false }
	}

	if (directCode === AI_PILOT_UNAVAILABLE_CODE) {
		return { kind: 'transport', retryable: false }
	}

	const status = getErrorProperty(error, 'status')
	if (typeof status === 'number') {
		const retryable = RETRYABLE_STATUS_CODES.has(status)
		return {
			kind: retryable ? 'transport' : 'other',
			retryable
		}
	}

	const cause = getErrorProperty(error, 'cause')
	const code = directCode ?? getStringProperty(cause, 'code')
	if (code && RETRYABLE_ERROR_CODES.has(code)) {
		return { kind: 'transport', retryable: true }
	}
	if (name && (RETRYABLE_ERROR_NAMES.has(name) || name === 'TimeoutError')) {
		return { kind: 'transport', retryable: true }
	}

	return { kind: 'other', retryable: false }
}

export const isTransportApiError = (error: unknown): boolean =>
	classifyApiError(error).kind === 'transport'

export const isRetryableApiError = (error: unknown): boolean =>
	classifyApiError(error).retryable

const sleep = (delayMs: number, signal?: AbortSignal): Promise<void> =>
	new Promise((resolve, reject) => {
		if (signal?.aborted) {
			reject(new Error('Agent request aborted'))
			return
		}

		const timer = setTimeout(() => {
			signal?.removeEventListener('abort', onAbort)
			resolve()
		}, delayMs)
		const onAbort = () => {
			clearTimeout(timer)
			reject(new Error('Agent request aborted'))
		}
		signal?.addEventListener('abort', onAbort, { once: true })
	})

export const withApiRetry = async <T>(
	action: () => Promise<T>,
	options: ApiRetryOptions = {}
): Promise<T> => {
	const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS
	const baseDelayMs = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS
	let lastError: unknown = null

	for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
		if (options.signal?.aborted) {
			throw new Error('Agent request aborted')
		}

		try {
			return await action()
		} catch (error) {
			lastError = error
			if (attempt >= maxAttempts || !isRetryableApiError(error)) {
				throw error
			}

			await sleep(baseDelayMs * 2 ** (attempt - 1), options.signal)
		}
	}

	throw lastError
}
