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
