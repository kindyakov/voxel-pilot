import assert from 'node:assert/strict'
import test from 'node:test'

import { Config } from '../../config/config.js'

test('Config reads provider base URL and validates API key for non-local providers', () => {
	const previousEnv = {
		AI_PROVIDER: process.env.AI_PROVIDER,
		AI_BASE_URL: process.env.AI_BASE_URL,
		AI_API_KEY: process.env.AI_API_KEY,
		AI_MODEL: process.env.AI_MODEL,
		AI_TIMEOUT_MS: process.env.AI_TIMEOUT_MS,
		AI_MAX_TOKENS: process.env.AI_MAX_TOKENS
	}

	process.env.AI_PROVIDER = 'openrouter'
	process.env.AI_BASE_URL = 'https://openrouter.ai/api/v1'
	process.env.AI_API_KEY = 'router-key'
	process.env.AI_MODEL = 'minimax/minimax-m2.5:free'
	process.env.AI_TIMEOUT_MS = '25000'
	process.env.AI_MAX_TOKENS = '1200'

	try {
		const config = new Config()

		assert.equal(config.ai.provider, 'openrouter')
		assert.equal(config.ai.baseUrl, 'https://openrouter.ai/api/v1')
		assert.equal(config.ai.apiKey, 'router-key')
		assert.equal(config.ai.model, 'minimax/minimax-m2.5:free')
		assert.equal(config.ai.timeout, 25000)
		assert.equal(config.ai.maxTokens, 1200)
		assert.doesNotThrow(() => config.assertAIConfigured())
	} finally {
		for (const [key, value] of Object.entries(previousEnv)) {
			if (typeof value === 'undefined') {
				delete process.env[key]
			} else {
				process.env[key] = value
			}
		}
	}
})

test('Config rejects missing API key for remote providers but allows local and disabled', () => {
	const previousEnv = {
		MINECRAFT_HOST: process.env.MINECRAFT_HOST,
		MINECRAFT_PORT: process.env.MINECRAFT_PORT,
		MINECRAFT_USERNAME: process.env.MINECRAFT_USERNAME,
		MINECRAFT_VERSION: process.env.MINECRAFT_VERSION,
		AI_PROVIDER: process.env.AI_PROVIDER,
		AI_API_KEY: process.env.AI_API_KEY,
		AI_MODEL: process.env.AI_MODEL
	}

	process.env.MINECRAFT_HOST = 'localhost'
	process.env.MINECRAFT_PORT = '25565'
	process.env.MINECRAFT_USERNAME = 'bot'
	process.env.MINECRAFT_VERSION = '1.20.4'
	process.env.AI_MODEL = 'test-model'
	delete process.env.AI_API_KEY

	try {
		process.env.AI_PROVIDER = 'openai'
		const remote = new Config()
		assert.throws(() => remote.assertAIConfigured(), /AI_API_KEY/)

		process.env.AI_PROVIDER = 'local'
		const local = new Config()
		assert.doesNotThrow(() => local.assertAIConfigured())

		process.env.AI_PROVIDER = 'disabled'
		const disabled = new Config()
		assert.doesNotThrow(() => disabled.assertAIConfigured())
	} finally {
		for (const [key, value] of Object.entries(previousEnv)) {
			if (typeof value === 'undefined') {
				delete process.env[key]
			} else {
				process.env[key] = value
			}
		}
	}
})

test('Config rejects malformed ports and reads diagnostics ports with defaults', () => {
	const previousEnv = {
		MINECRAFT_HOST: process.env.MINECRAFT_HOST,
		MINECRAFT_PORT: process.env.MINECRAFT_PORT,
		MINECRAFT_USERNAME: process.env.MINECRAFT_USERNAME,
		MINECRAFT_VERSION: process.env.MINECRAFT_VERSION,
		AI_PROVIDER: process.env.AI_PROVIDER,
		AI_MODEL: process.env.AI_MODEL,
		MINECRAFT_VIEWER_PORT: process.env.MINECRAFT_VIEWER_PORT,
		MINECRAFT_WEB_INVENTORY_PORT: process.env.MINECRAFT_WEB_INVENTORY_PORT
	}

	process.env.MINECRAFT_HOST = 'localhost'
	process.env.MINECRAFT_PORT = '25565'
	process.env.MINECRAFT_USERNAME = 'bot'
	process.env.MINECRAFT_VERSION = '1.20.4'
	process.env.AI_PROVIDER = 'disabled'
	process.env.AI_MODEL = 'test-model'

	try {
		delete process.env.MINECRAFT_VIEWER_PORT
		delete process.env.MINECRAFT_WEB_INVENTORY_PORT
		const defaults = new Config()
		assert.equal(defaults.diagnostics.viewerPort, 3000)
		assert.equal(defaults.diagnostics.webInventoryPort, 3001)

		process.env.MINECRAFT_VIEWER_PORT = '3100'
		process.env.MINECRAFT_WEB_INVENTORY_PORT = '3101'
		const custom = new Config()
		assert.equal(custom.diagnostics.viewerPort, 3100)
		assert.equal(custom.diagnostics.webInventoryPort, 3101)

		process.env.MINECRAFT_PORT = 'not-a-port'
		assert.throws(() => new Config(), /Invalid environment variables/)
	} finally {
		for (const [key, value] of Object.entries(previousEnv)) {
			if (typeof value === 'undefined') {
				delete process.env[key]
			} else {
				process.env[key] = value
			}
		}
	}
})
