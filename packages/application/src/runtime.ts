import { dirname, join, resolve } from 'node:path'

import { type BotRuntimeOptions, createBotRuntime } from '@voxel-pilot/core'
import {
	defaultDataDirectory,
	defaultLogFile,
	defaultRequestDumpDirectory,
	repositoryRoot
} from '@voxel-pilot/core/paths'
import {
	type RuntimeLoggerOptions,
	type RuntimePaths,
	createRuntimeConfigFromEnvironment,
	createRuntimeLogger,
	createRuntimeServices
} from '@voxel-pilot/core/services'

import { type EnvironmentSnapshot, loadSettings } from './settings.js'

export interface ApplicationRuntimeOptions extends BotRuntimeOptions {
	readonly environment?: EnvironmentSnapshot
	readonly settingsFile?: string | null
	readonly paths?: Partial<Omit<RuntimePaths, 'settingsFile'>>
	readonly output?: Pick<RuntimeLoggerOptions, 'console' | 'files'>
	readonly mode?: 'cli' | 'tui'
}

export function selectRuntimePaths(
	environment: EnvironmentSnapshot,
	settingsFile: string | null,
	overrides: Partial<Omit<RuntimePaths, 'settingsFile'>> = {}
): RuntimePaths {
	const logFile =
		overrides.logFile ??
		(environment.LOG_FILE
			? resolve(repositoryRoot, environment.LOG_FILE)
			: defaultLogFile)
	return {
		settingsFile,
		memoryDir: defaultDataDirectory,
		profileDir: defaultDataDirectory,
		aiRequestDumpDir: defaultRequestDumpDirectory,
		...overrides,
		logFile,
		errorLogFile: overrides.errorLogFile ?? join(dirname(logFile), 'error.log')
	}
}

/** Explicit app composition; importing it does not load settings or allocate resources. */
export function createApplicationRuntime(
	options: ApplicationRuntimeOptions = {}
) {
	if (
		options.stopTimeoutMs !== undefined &&
		(!Number.isSafeInteger(options.stopTimeoutMs) ||
			options.stopTimeoutMs <= 0 ||
			options.stopTimeoutMs > 2_147_483_647)
	) {
		throw new Error('stopTimeoutMs must be positive and finite')
	}
	const loaded = loadSettings(
		options.environment ?? process.env,
		options.settingsFile
	)
	const config = createRuntimeConfigFromEnvironment(
		loaded.values,
		selectRuntimePaths(loaded.values, loaded.settingsFile, options.paths)
	)
	const loggerHandle = createRuntimeLogger({
		aiModel: config.ai.model,
		console:
			options.mode === 'tui'
				? false
				: options.output
					? options.output.console
					: {
							level: config.isDevelopment ? 'debug' : config.logging.level,
							colors: true
						},
		files:
			options.output &&
			(options.mode !== 'tui' || options.output.files !== undefined)
				? options.output.files
				: {
						logFile: config.paths.logFile,
						errorLogFile: config.paths.errorLogFile,
						level: config.logging.level,
						maxBytes: 10 * 1024 * 1024,
						maxFiles: 5
					}
	})
	const services = createRuntimeServices({
		config,
		logger: loggerHandle.logger
	})
	return Object.freeze({
		services,
		loggerHandle,
		runtime: createBotRuntime(services, {
			connection: options.connection,
			stopTimeoutMs: options.stopTimeoutMs,
			inspection: options.inspection,
			logs:
				options.mode === 'tui'
					? { ...options.logs, level: 'debug' }
					: options.logs
		})
	})
}
