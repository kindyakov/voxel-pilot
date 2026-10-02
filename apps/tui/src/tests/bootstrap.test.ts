import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
	createApplicationRuntime,
	loadSettings,
	selectRuntimePaths
} from '@voxel-pilot/application'

import { createTuiRuntime } from '../app/bootstrap.js'

const values = {
	MINECRAFT_HOST: 'localhost',
	MINECRAFT_PORT: '25565',
	MINECRAFT_USERNAME: 'tui-composition-fixture',
	MINECRAFT_VERSION: '1.20.4',
	AI_PROVIDER: 'disabled',
	AI_MODEL: 'fixture',
	LOG_LEVEL: 'warn'
}

test('real TUI/shared composition preserves CLI precedence/paths while files and DEBUG source remain independent', async t => {
	const directory = await mkdtemp(join(tmpdir(), 'voxel-tui-composition-'))
	t.after(() => rm(directory, { recursive: true, force: true }))
	const filename = join(directory, 'fixture.env')
	await writeFile(filename, 'AI_MODEL=file-model\nLOG_LEVEL=info\n')
	const paths = {
		memoryDir: join(directory, 'memory'),
		profileDir: join(directory, 'profile'),
		logFile: join(directory, 'bot.log'),
		aiRequestDumpDir: join(directory, 'dumps')
	}
	const loaded = loadSettings(values, filename)
	assert.equal(loaded.values.AI_MODEL, 'fixture')
	assert.equal(loaded.values.LOG_LEVEL, 'warn')
	const cli = createApplicationRuntime({
		environment: values,
		settingsFile: filename,
		paths,
		output: { console: false, files: false }
	})
	const selected = cli.services.config.paths
	await cli.runtime.stop()
	await cli.loggerHandle.close()
	const terminal: unknown[] = []
	t.mock.method(process.stdout, 'write', (value: unknown) => {
		terminal.push(value)
		return true
	})
	t.mock.method(process.stderr, 'write', (value: unknown) => {
		terminal.push(value)
		return true
	})
	// Supplying only console:false must retain default TUI file output.
	const tui = createTuiRuntime({
		environment: values,
		settingsFile: filename,
		paths,
		output: { console: false }
	})
	try {
		assert.deepEqual(tui.services.config.paths, selected)
		assert.deepEqual(
			selected,
			selectRuntimePaths(loaded.values, filename, paths)
		)
		tui.loggerHandle.logger.debug('debug source only')
		tui.loggerHandle.logger.info('info source only')
		tui.loggerHandle.logger.warn('warn file')
		const history = tui.runtime.telemetry.getLogHistory()
		assert.equal(history.level, 'debug')
		assert.equal(history.entries.length, 3)
		assert.deepEqual(history.stats.acceptedByLevel, {
			debug: 1,
			info: 1,
			warn: 1,
			error: 0
		})
		assert.deepEqual(terminal, [])
	} finally {
		await tui.runtime.stop()
		await tui.loggerHandle.close()
	}
	const file = await readFile(paths.logFile, 'utf8')
	assert.match(file, /warn file/)
	assert.ok(
		!file.includes('debug source only') && !file.includes('info source only')
	)
})
