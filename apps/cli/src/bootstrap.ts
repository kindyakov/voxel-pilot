import { dirname, join, resolve } from 'node:path'

import { type ConnectionDependencies, MinecraftBot } from '@voxel-pilot/core'
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

export interface CliBootstrapOptions {
	readonly environment?: EnvironmentSnapshot
	readonly settingsFile?: string | null
	readonly paths?: Partial<Omit<RuntimePaths, 'settingsFile'>>
	readonly output?: Pick<RuntimeLoggerOptions, 'console' | 'files'>
	readonly connection?: Partial<ConnectionDependencies>
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

/** Composes app-owned output and an inert core; only the entrypoint calls start. */
export function createCliRuntime(options: CliBootstrapOptions = {}) {
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
		console: options.output
			? options.output.console
			: {
					level: config.isDevelopment ? 'debug' : config.logging.level,
					colors: true
				},
		files: options.output
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
		runtime: new MinecraftBot(services, options.connection)
	})
}

/** Standalone tools require output, not Minecraft or provider configuration. */
export function createCommandLogger() {
	return createRuntimeLogger({
		aiModel: 'command',
		console: { level: 'info', colors: true },
		files: false
	})
}
