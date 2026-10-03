import { isAbsolute } from 'node:path'

import { isAiPilotDisabled } from '../ai/pilotAvailability.js'
import { validateEnvironmentValues } from './env.js'

export type RuntimeLogLevel = 'debug' | 'info' | 'warn' | 'error'
export type AiProvider =
	| 'openai'
	| 'routerai'
	| 'openrouter'
	| 'openai_compatible'
	| 'local'
	| 'disabled'

export interface MinecraftConfig {
	readonly host: string
	readonly port: number
	readonly username: string
	readonly version: string
}

export interface AIConfig {
	readonly provider: AiProvider
	readonly baseUrl: string | undefined
	readonly model: string
	readonly apiKey: string | undefined
	readonly timeout: number
	readonly maxTokens: number
}

export interface DiagnosticsConfig {
	readonly viewerPort: number
	readonly webInventoryPort: number
	readonly hsmEnabled: boolean
}

export interface RuntimePaths {
	readonly settingsFile: string | null
	readonly memoryDir: string
	readonly profileDir: string
	readonly logFile: string
	readonly errorLogFile: string
	readonly aiRequestDumpDir: string
}

export interface RuntimeConfig {
	readonly minecraft: MinecraftConfig
	readonly ai: AIConfig
	readonly diagnostics: DiagnosticsConfig
	readonly logging: Readonly<{ level: RuntimeLogLevel }>
	readonly paths: RuntimePaths
	readonly environment: string
	readonly aiDebugDump: boolean
	readonly isDevelopment: boolean
	readonly isProduction: boolean
}

export type RuntimeConfigValues = Omit<
	RuntimeConfig,
	'isDevelopment' | 'isProduction'
>

const providers: readonly string[] = [
	'openai',
	'routerai',
	'openrouter',
	'openai_compatible',
	'local',
	'disabled'
]
const levels: readonly string[] = ['debug', 'info', 'warn', 'error']

function requireText(value: string, name: string): void {
	if (typeof value !== 'string' || value.trim().length === 0) {
		throw new Error(`Invalid runtime configuration: ${name} must be nonempty`)
	}
}

function requireInteger(value: number, name: string, max?: number): void {
	if (!Number.isSafeInteger(value) || value <= 0 || (max && value > max)) {
		throw new Error(`Invalid runtime configuration: ${name} is out of range`)
	}
}

/** Copies validated values; loading settings and selecting paths belong to the app. */
export function createRuntimeConfig(
	values: RuntimeConfigValues
): RuntimeConfig {
	const { minecraft, ai, diagnostics, logging, paths } = values
	for (const key of ['host', 'username', 'version'] as const) {
		requireText(minecraft[key], `minecraft.${key}`)
	}
	for (const [name, port] of [
		['minecraft.port', minecraft.port],
		['diagnostics.viewerPort', diagnostics.viewerPort],
		['diagnostics.webInventoryPort', diagnostics.webInventoryPort]
	] as const) {
		requireInteger(port, name, 65535)
	}
	if (!providers.includes(ai.provider)) {
		throw new Error('Invalid runtime configuration: ai.provider')
	}
	requireText(ai.model, 'ai.model')
	requireInteger(ai.timeout, 'ai.timeout')
	requireInteger(ai.maxTokens, 'ai.maxTokens')
	if (!isAiPilotDisabled(ai.provider)) {
		requireText(ai.apiKey!, 'AI_API_KEY')
	}
	if (ai.baseUrl !== undefined) {
		let url: URL
		try {
			url = new URL(ai.baseUrl)
		} catch {
			throw new Error('Invalid runtime configuration: ai.baseUrl')
		}
		if (url.protocol !== 'http:' && url.protocol !== 'https:') {
			throw new Error('Invalid runtime configuration: ai.baseUrl')
		}
	}
	if (!levels.includes(logging.level)) {
		throw new Error('Invalid runtime configuration: logging.level')
	}
	requireText(values.environment, 'environment')
	if (typeof values.aiDebugDump !== 'boolean') {
		throw new Error('Invalid runtime configuration: aiDebugDump')
	}
	if (typeof diagnostics.hsmEnabled !== 'boolean') {
		throw new Error('Invalid runtime configuration: diagnostics.hsmEnabled')
	}
	for (const name of [
		'settingsFile',
		'memoryDir',
		'profileDir',
		'logFile',
		'errorLogFile',
		'aiRequestDumpDir'
	] as const) {
		const value = paths[name]
		if (name === 'settingsFile' && value === null) continue
		requireText(value!, `paths.${name}`)
		if (!isAbsolute(value!)) {
			throw new Error(
				`Invalid runtime configuration: paths.${name} must be absolute`
			)
		}
	}
	return Object.freeze({
		minecraft: Object.freeze({ ...minecraft }),
		ai: Object.freeze({ ...ai }),
		diagnostics: Object.freeze({ ...diagnostics }),
		logging: Object.freeze({ ...logging }),
		paths: Object.freeze({ ...paths }),
		environment: values.environment,
		aiDebugDump: values.aiDebugDump,
		isDevelopment: values.environment === 'development',
		isProduction: values.environment === 'production'
	})
}

/** Converts an already loaded environment snapshot without accessing process.env. */
export function createRuntimeConfigFromEnvironment(
	values: Readonly<Record<string, string | undefined>>,
	paths: RuntimePaths
): RuntimeConfig {
	const env = validateEnvironmentValues(values)
	for (const key of ['AI_DEBUG_DUMP', 'HSM_DIAGNOSTICS'] as const) {
		if (env[key] !== undefined && !['0', '1'].includes(env[key]!)) {
			throw new Error(`Invalid runtime configuration: ${key} must be 0 or 1`)
		}
	}
	return createRuntimeConfig({
		minecraft: {
			host: env.MINECRAFT_HOST!,
			port: Number(env.MINECRAFT_PORT),
			username: env.MINECRAFT_USERNAME!,
			version: env.MINECRAFT_VERSION!
		},
		ai: {
			provider: env.AI_PROVIDER as AiProvider,
			baseUrl: env.AI_BASE_URL || undefined,
			model: env.AI_MODEL!,
			apiKey: env.AI_API_KEY,
			timeout: Number(env.AI_TIMEOUT_MS ?? '15000'),
			maxTokens: Number(env.AI_MAX_TOKENS ?? '1000')
		},
		diagnostics: {
			viewerPort: Number(env.MINECRAFT_VIEWER_PORT ?? '3000'),
			webInventoryPort: Number(env.MINECRAFT_WEB_INVENTORY_PORT ?? '3001'),
			hsmEnabled: env.HSM_DIAGNOSTICS === '1'
		},
		logging: { level: (env.LOG_LEVEL ?? 'info') as RuntimeLogLevel },
		paths,
		environment: env.NODE_ENV ?? 'production',
		aiDebugDump: env.AI_DEBUG_DUMP === '1'
	})
}
