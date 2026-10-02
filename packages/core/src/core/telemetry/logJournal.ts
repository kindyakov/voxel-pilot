import { randomUUID } from 'node:crypto'

import type {
	LogEntry,
	LogHistory,
	LogHistoryLimits,
	LogLevel,
	LogUpdate
} from '@voxel-pilot/contracts'

import type { AIConfig } from '@/config/runtimeConfig.js'
import type { RuntimeLogRecord } from '@/config/runtimeLogger.js'

import { createSecretRedactor } from './safeText.js'

export interface LogHistoryOptions extends Partial<LogHistoryLimits> {
	readonly level?: LogLevel
}

const defaults: LogHistoryLimits = Object.freeze({
	maxEntries: 2_000,
	maxBytes: 2 * 1024 * 1024,
	maxEntryBytes: 16 * 1024
})
const levels = { error: 0, warn: 1, info: 2, debug: 3 } satisfies Record<
	LogLevel,
	number
>
const sources = new Set([
	'CORE',
	'AI',
	'HSM',
	'COMBAT',
	'SURVIVAL',
	'TASKS',
	'MINING',
	'OBSERVATION',
	'CONNECTION',
	'PATH',
	'MEMORY',
	'PROFILE'
])
const scalarFields = [
	'reason',
	'status',
	'attempt',
	'duration',
	'model',
	'promptLength',
	'responseLength'
] as const
const marker = '… [truncated]'

function byteSize(entry: LogEntry): number {
	return Buffer.byteLength(JSON.stringify(entry), 'utf8')
}

function safePrefix(text: string, length: number): string {
	if (length > 0 && /[\uD800-\uDBFF]/.test(text[length - 1]!)) length--
	return text.slice(0, length)
}

/** The sole bounded source history. Raw metadata is never retained or serialized. */
export function createLogJournal(
	ai: AIConfig,
	options: LogHistoryOptions = {}
) {
	const level = options.level ?? 'debug'
	if (!Object.hasOwn(levels, level))
		throw new Error('Invalid log history level')
	const limits = Object.freeze({
		maxEntries: options.maxEntries ?? defaults.maxEntries,
		maxBytes: options.maxBytes ?? defaults.maxBytes,
		maxEntryBytes: options.maxEntryBytes ?? defaults.maxEntryBytes
	})
	for (const [name, value] of Object.entries(limits)) {
		if (
			!Number.isSafeInteger(value) ||
			value < (name === 'maxEntries' ? 1 : 256)
		) {
			throw new Error(
				'Log history limits must be positive safe integers; byte limits must be at least 256'
			)
		}
	}
	const id = randomUUID()
	const redact = createSecretRedactor(ai)
	const entries: { entry: LogEntry; bytes: number }[] = []
	const acceptedByLevel = { debug: 0, info: 0, warn: 0, error: 0 }
	let revision = 0,
		retainedBytes = 0,
		evictedEntries = 0,
		evictedBytes = 0,
		truncatedEntries = 0
	let active = true
	const listeners = new Set<{ listener: (update: LogUpdate) => void }>()
	const makeHistory = (): LogHistory =>
		Object.freeze({
			id,
			revision,
			level,
			limits,
			entries: Object.freeze(entries.map(value => value.entry)),
			stats: Object.freeze({
				retainedEntries: entries.length,
				retainedBytes,
				acceptedEntries: revision,
				acceptedByLevel: Object.freeze({ ...acceptedByLevel }),
				evictedEntries,
				evictedBytes,
				truncatedEntries
			})
		})
	let history = makeHistory()
	const deliver = (
		listener: (update: LogUpdate) => void,
		update: LogUpdate
	) => {
		try {
			void Promise.resolve(listener(update)).catch(() => {})
		} catch {
			// Never feed observer failures back into the same log stream.
		}
	}
	return {
		level,
		getHistory: () => history,
		subscribe(listener: (update: LogUpdate) => void) {
			const subscription = { listener }
			if (active) listeners.add(subscription)
			deliver(listener, Object.freeze({ kind: 'snapshot', history }))
			return () => {
				listeners.delete(subscription)
			}
		},
		resume() {
			active = true
		},
		detach() {
			active = false
			listeners.clear()
		},
		append(record: RuntimeLogRecord) {
			if (!active || levels[record.level] > levels[level]) return
			const candidate =
				typeof record.meta.source === 'string'
					? record.meta.source.toUpperCase()
					: /^\[([a-z]+)\]/i.exec(record.message)?.[1]?.toUpperCase()
			const source = candidate && sources.has(candidate) ? candidate : 'CORE'
			const facts: string[] = []
			for (const field of scalarFields) {
				const value = record.meta[field]
				if (
					typeof value === 'string' ||
					typeof value === 'boolean' ||
					(typeof value === 'number' && Number.isFinite(value))
				) {
					facts.push(`${field}=${value}`)
				}
			}
			const projected = redact(
				record.message + (facts.length ? ` (${facts.join(', ')})` : '')
			)
			// Normalization replaces malformed surrogate input, without interpreting terminal controls.
			const message = Buffer.from(projected, 'utf8')
				.toString('utf8')
				.replace(
					/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g,
					control => `\\u${control.charCodeAt(0).toString(16).padStart(4, '0')}`
				)
			const timestamp = Date.parse(record.timestamp)
			const base = {
				id: `${id}:${revision + 1}`,
				timestamp: Number.isFinite(timestamp) ? timestamp : Date.now(),
				level: record.level,
				source
			}
			let entry: LogEntry = { ...base, message, truncation: null }
			const cap = Math.min(limits.maxEntryBytes, limits.maxBytes)
			if (byteSize(entry) > cap) {
				const truncation = Object.freeze({
					originalMessageBytes: Buffer.byteLength(message, 'utf8')
				})
				let low = 0,
					high = Math.min(message.length, cap)
				while (low < high) {
					const mid = Math.ceil((low + high) / 2)
					const trial = {
						...base,
						message: safePrefix(message, mid) + marker,
						truncation
					}
					if (byteSize(trial) <= cap) low = mid
					else high = mid - 1
				}
				entry = {
					...base,
					message: safePrefix(message, low) + marker,
					truncation
				}
				truncatedEntries++
			}
			entry = Object.freeze(entry)
			const bytes = byteSize(entry)
			entries.push({ entry, bytes })
			retainedBytes += bytes
			revision++
			acceptedByLevel[record.level]++
			while (
				entries.length > limits.maxEntries ||
				retainedBytes > limits.maxBytes
			) {
				const removed = entries.shift()!
				retainedBytes -= removed.bytes
				evictedBytes += removed.bytes
				evictedEntries++
			}
			history = makeHistory()
			const update: LogUpdate = Object.freeze({
				kind: 'append',
				entry,
				history
			})
			for (const subscription of [...listeners]) {
				if (history !== update.history) break
				if (listeners.has(subscription)) deliver(subscription.listener, update)
			}
		}
	}
}
