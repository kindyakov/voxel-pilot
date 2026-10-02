import assert from 'node:assert/strict'
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'

import {
	defaultDataDirectory,
	defaultLogFile,
	defaultRequestDumpDirectory,
	repositoryRoot
} from '@voxel-pilot/core/paths'

import { createCliRuntime, selectRuntimePaths } from '../bootstrap.js'
import { loadSettings } from '../settings.js'

const values = {
	MINECRAFT_HOST: 'localhost',
	MINECRAFT_PORT: '25565',
	MINECRAFT_USERNAME: 'bootstrap-fixture',
	MINECRAFT_VERSION: '1.20.4',
	AI_PROVIDER: 'disabled',
	AI_MODEL: 'fixture-model'
}

test('called settings loading merges a supplied snapshot without changing environment', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'voxel-cli-settings-'))
	try {
		const filename = join(directory, 'fixture.env')
		await writeFile(
			filename,
			'AI_MODEL=file-model\nLOG_LEVEL=debug\nFILE_ONLY_MARKER=fixture\n'
		)
		const environment = Object.freeze({ ...values, LOG_LEVEL: undefined })
		const loaded = loadSettings(environment, filename)
		assert.equal(loaded.settingsFile, filename)
		assert.equal(loaded.values.AI_MODEL, 'fixture-model')
		assert.equal(loaded.values.LOG_LEVEL, 'debug')
		assert.equal(loaded.values.FILE_ONLY_MARKER, 'fixture')
		assert.equal(environment.LOG_LEVEL, undefined)
		assert.equal(process.env.FILE_ONLY_MARKER, undefined)
		assert.ok(Object.isFrozen(loaded.values))
		assert.deepEqual(loadSettings(environment, null).values, values)
		assert.deepEqual(
			loadSettings(environment, join(directory, 'absent.env')).values,
			values
		)
		assert.equal(
			loadSettings({ DOTENV_CONFIG_PATH: filename }).settingsFile,
			filename
		)
	} finally {
		await rm(directory, { recursive: true, force: true })
	}
})

test('path selection retains repository data defaults and resolves LOG_FILE against the repository', () => {
	const defaults = selectRuntimePaths({}, null)
	assert.equal(defaults.memoryDir, defaultDataDirectory)
	assert.equal(defaults.profileDir, defaultDataDirectory)
	assert.equal(defaults.logFile, defaultLogFile)
	assert.equal(defaults.aiRequestDumpDir, defaultRequestDumpDirectory)
	assert.equal(defaults.settingsFile, null)
	const custom = selectRuntimePaths(
		{ LOG_FILE: 'custom/logs/general.log' },
		null
	)
	assert.equal(
		custom.logFile,
		resolve(repositoryRoot, 'custom/logs/general.log')
	)
	assert.equal(custom.errorLogFile, join(dirname(custom.logFile), 'error.log'))
	const selected = selectRuntimePaths({}, null, {
		memoryDir: tmpdir(),
		logFile: join(tmpdir(), 'selected.log')
	})
	assert.equal(selected.memoryDir, tmpdir())
	assert.equal(selected.errorLogFile, join(tmpdir(), 'error.log'))
})

test('explicit CLI composition validates configuration and creates no bot or stores before start', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'voxel-cli-bootstrap-'))
	let connections = 0
	try {
		const app = createCliRuntime({
			environment: values,
			settingsFile: null,
			paths: {
				memoryDir: join(directory, 'memory'),
				profileDir: join(directory, 'profile'),
				logFile: join(directory, 'bot.log'),
				aiRequestDumpDir: join(directory, 'dumps')
			},
			output: { console: false, files: false },
			connection: {
				createBot: () => {
					connections++
					throw new Error('must not connect')
				},
				initConnection: () => {
					throw new Error('must not initialize')
				}
			}
		})
		try {
			assert.equal(connections, 0)
			assert.deepEqual(await readdir(directory), [])
			assert.equal(app.services.config.minecraft.username, 'bootstrap-fixture')
			assert.equal(
				app.services.config.paths.memoryDir,
				join(directory, 'memory')
			)
			assert.equal(
				app.services.config.paths.profileDir,
				join(directory, 'profile')
			)
			await app.runtime.stop()
			app.loggerHandle.logger.info('app still owns logger')
		} finally {
			await app.runtime.stop()
			await app.loggerHandle.close()
		}
		assert.throws(
			() =>
				createCliRuntime({
					environment: { ...values, AI_PROVIDER: 'openai' },
					settingsFile: null
				}),
			/AI_API_KEY/
		)
		assert.deepEqual(await readdir(directory), [])
	} finally {
		await rm(directory, { recursive: true, force: true })
	}
})
