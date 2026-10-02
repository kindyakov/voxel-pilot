import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after } from 'node:test'

import type { AgentClientOptions } from '../../../ai/contracts/agentClient.js'
import type { AIConfig } from '../../../config/runtimeConfig.js'
import {
	type RuntimeLogRecord,
	createRuntimeLogger
} from '../../../config/runtimeLogger.js'

export function createTestLogger(records: RuntimeLogRecord[] = []) {
	const handle = createRuntimeLogger({
		aiModel: 'test-model',
		console: false,
		files: false,
		sink: { level: 'debug', write: record => records.push(record) }
	})
	after(() => handle.close())
	return handle.logger
}

export function createTestClientOptions(
	overrides: Partial<AgentClientOptions> = {}
): AgentClientOptions {
	return {
		apiKey: 'test-key',
		baseUrl: 'http://127.0.0.1:1/v1',
		model: 'test-model',
		timeoutMs: 5000,
		maxOutputTokens: 1000,
		logger: createTestLogger(),
		debugDump: { enabled: false, directory: join(tmpdir(), 'unused-ai-dumps') },
		...overrides
	}
}

export function createTestAgentDependencies() {
	const options = createTestClientOptions()
	const ai: AIConfig = {
		provider: 'disabled',
		baseUrl: options.baseUrl,
		model: options.model,
		apiKey: undefined,
		timeout: options.timeoutMs,
		maxTokens: options.maxOutputTokens
	}
	return { ai, logger: options.logger, debugDump: options.debugDump }
}
