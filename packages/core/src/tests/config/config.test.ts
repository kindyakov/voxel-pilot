import assert from 'node:assert/strict'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { createRuntimeConfigFromEnvironment } from '../../config/runtimeConfig.js'

const environment = {
	MINECRAFT_HOST: 'localhost',
	MINECRAFT_PORT: '25565',
	MINECRAFT_USERNAME: 'bot',
	MINECRAFT_VERSION: '1.20.4',
	AI_PROVIDER: 'disabled',
	AI_MODEL: 'test-model'
}
const paths = {
	settingsFile: null,
	memoryDir: tmpdir(),
	profileDir: tmpdir(),
	logFile: join(tmpdir(), 'fixture.log'),
	errorLogFile: join(tmpdir(), 'error.log'),
	aiRequestDumpDir: join(tmpdir(), 'fixture-dumps')
}

test('Config reads provider base URL and validates API key for non-local providers', () => {
	const config = createRuntimeConfigFromEnvironment(
		{
			...environment,
			AI_PROVIDER: 'openrouter',
			AI_BASE_URL: 'https://openrouter.ai/api/v1',
			AI_API_KEY: 'router-key',
			AI_MODEL: 'minimax/minimax-m2.5:free',
			AI_TIMEOUT_MS: '25000',
			AI_MAX_TOKENS: '1200'
		},
		paths
	)
	assert.equal(config.ai.provider, 'openrouter')
	assert.equal(config.ai.baseUrl, 'https://openrouter.ai/api/v1')
	assert.equal(config.ai.apiKey, 'router-key')
	assert.equal(config.ai.model, 'minimax/minimax-m2.5:free')
	assert.equal(config.ai.timeout, 25000)
	assert.equal(config.ai.maxTokens, 1200)
})

test('Config rejects missing API key for remote providers but allows local and disabled', () => {
	assert.throws(
		() =>
			createRuntimeConfigFromEnvironment(
				{ ...environment, AI_PROVIDER: 'openai' },
				paths
			),
		/AI_API_KEY/
	)
	assert.doesNotThrow(() =>
		createRuntimeConfigFromEnvironment(
			{ ...environment, AI_PROVIDER: 'local' },
			paths
		)
	)
	assert.doesNotThrow(() =>
		createRuntimeConfigFromEnvironment(environment, paths)
	)
})

test('Config rejects malformed ports and reads diagnostics ports with defaults', () => {
	const defaults = createRuntimeConfigFromEnvironment(environment, paths)
	assert.equal(defaults.diagnostics.viewerPort, 3000)
	assert.equal(defaults.diagnostics.webInventoryPort, 3001)
	const custom = createRuntimeConfigFromEnvironment(
		{
			...environment,
			MINECRAFT_VIEWER_PORT: '3100',
			MINECRAFT_WEB_INVENTORY_PORT: '3101'
		},
		paths
	)
	assert.equal(custom.diagnostics.viewerPort, 3100)
	assert.equal(custom.diagnostics.webInventoryPort, 3101)
	assert.throws(
		() =>
			createRuntimeConfigFromEnvironment(
				{ ...environment, MINECRAFT_PORT: 'not-a-port' },
				paths
			),
		/Invalid environment variables/
	)
})
