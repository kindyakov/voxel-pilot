import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { buildHsmDrawioDiagram } from '@voxel-pilot/core/hsm-diagram'
import { repositoryRoot } from '@voxel-pilot/core/paths'

import { createCommandLogger } from '../bootstrap.js'

const handle = createCommandLogger()
const Logger = handle.logger

const outputDirectory = resolve(repositoryRoot, 'docs', 'diagrams')
const drawioOutputPath = resolve(outputDirectory, 'xstate-machine.drawio')

const main = async () => {
	const diagram = buildHsmDrawioDiagram()

	await mkdir(outputDirectory, { recursive: true })
	await writeFile(drawioOutputPath, diagram.xml, 'utf8')

	Logger.info('HSM diagram generated', {
		path: drawioOutputPath,
		stateCount: diagram.statePaths.length,
		animatedEdgeCount: diagram.animatedEdgeIds.length
	})
}

try {
	await main()
} finally {
	await handle.close()
}
