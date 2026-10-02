import { dirname, join, resolve } from 'node:path'

import Config from './config.js'
import { createRuntimeLogger } from './runtimeLogger.js'

/**
 * @deprecated Temporary CLI compatibility while #24–#26 migrate consumers.
 * Import the explicit services API for instance-owned logging without env/file effects.
 */
const legacyLogger = createRuntimeLogger({
	aiModel: Config.ai.model,
	console: {
		level: Config.isDevelopment ? 'debug' : Config.logging.level,
		colors: true
	},
	files:
		Config.isProduction || Config.logging.file
			? {
					logFile: Config.logging.file,
					errorLogFile: join(
						dirname(resolve(Config.logging.file)),
						'error.log'
					),
					level: Config.logging.level,
					maxBytes: 10 * 1024 * 1024,
					maxFiles: 5
				}
			: false
})

export default legacyLogger.logger
