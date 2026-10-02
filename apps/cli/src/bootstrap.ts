import {
	type ApplicationRuntimeOptions,
	createApplicationRuntime
} from '@voxel-pilot/application'
import { createRuntimeLogger } from '@voxel-pilot/core/services'

export { selectRuntimePaths } from '@voxel-pilot/application'
export type CliBootstrapOptions = Omit<ApplicationRuntimeOptions, 'mode'>

/** Shared explicit composition; only the entrypoint calls start. */
export function createCliRuntime(options: CliBootstrapOptions = {}) {
	return createApplicationRuntime({ ...options, mode: 'cli' })
}

/** Standalone tools require output, not Minecraft or provider configuration. */
export function createCommandLogger() {
	return createRuntimeLogger({
		aiModel: 'command',
		console: { level: 'info', colors: true },
		files: false
	})
}
