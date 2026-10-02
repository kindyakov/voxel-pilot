import { resolve } from 'node:path'

import {
	formatSchematicSummary,
	inspectSchematicFile
} from '@voxel-pilot/core/schematic'

import { createCommandLogger } from '../bootstrap.js'

const handle = createCommandLogger()
const Logger = handle.logger

const main = async () => {
	const invocationDirectory = process.env.INIT_CWD ?? process.cwd()
	const paths = process.argv
		.slice(2)
		.map(value => resolve(invocationDirectory, value))

	if (paths.length === 0) {
		Logger.error(
			'Usage: pnpm run inspect-schematic <path-to-file.schem> [more-files...]'
		)
		process.exitCode = 1
		return
	}

	for (let index = 0; index < paths.length; index += 1) {
		const filePath = paths[index]!
		const summary = await inspectSchematicFile(filePath)
		if (index > 0) {
			Logger.info('')
		}
		Logger.info(formatSchematicSummary(summary))
	}
}

try {
	await main()
} catch (error) {
	Logger.error(
		error instanceof Error
			? error.message
			: 'Unknown schematic inspection error',
		{
			stack: error instanceof Error ? error.stack : undefined
		}
	)
	process.exitCode = 1
} finally {
	await handle.close()
}
