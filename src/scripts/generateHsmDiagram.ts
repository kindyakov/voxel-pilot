import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import Logger from '@/config/logger.js'

import { buildHsmDrawioDiagram } from '@/hsm/utils/hsmDrawioDiagram.js'

const outputDirectory = resolve(process.cwd(), 'docs', 'diagrams')
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

await main()
