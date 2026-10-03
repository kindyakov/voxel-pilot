import type { RuntimeConfig } from './runtimeConfig.js'
import type { RuntimeLogger } from './runtimeLogger.js'

export interface RuntimeServices {
	readonly config: RuntimeConfig
	readonly logger: RuntimeLogger
}

/** The application owns the logger handle; composition starts no bot or storage. */
export function createRuntimeServices(
	services: RuntimeServices
): RuntimeServices {
	return Object.freeze({ config: services.config, logger: services.logger })
}
