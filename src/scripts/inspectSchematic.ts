import Logger from '@/config/logger.js'

import {
	formatSchematicSummary,
	inspectSchematicFile
} from '../building/schematicInspection.js'

const main = async () => {
	const paths = process.argv.slice(2)

	if (paths.length === 0) {
		Logger.error(
			'Usage: npm run inspect-schematic -- <path-to-file.schem> [more-files...]'
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

main().catch(error => {
	Logger.error(
		error instanceof Error ? error.message : 'Unknown schematic inspection error',
		{
			stack: error instanceof Error ? error.stack : undefined
		}
	)
	process.exitCode = 1
})
