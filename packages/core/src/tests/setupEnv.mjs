import { devNull, tmpdir } from 'node:os'
import { join } from 'node:path'

// Test imports must work before per-test fixtures run, without a private .env.
Object.assign(process.env, {
	DOTENV_CONFIG_PATH: devNull,
	MINECRAFT_HOST: 'localhost',
	MINECRAFT_PORT: '25565',
	MINECRAFT_USERNAME: 'test-bot',
	MINECRAFT_VERSION: '1.20.4',
	MINECRAFT_VIEWER_PORT: '3000',
	MINECRAFT_WEB_INVENTORY_PORT: '3001',
	AI_PROVIDER: 'openai',
	AI_MODEL: 'test-model',
	AI_BASE_URL: 'http://127.0.0.1:9/v1',
	AI_API_KEY: 'test-key',
	AI_TIMEOUT_MS: '15000',
	AI_MAX_TOKENS: '1000',
	AI_DEBUG_DUMP: '0',
	LOG_LEVEL: 'info',
	LOG_FILE: join(tmpdir(), `voxel-pilot-tests-${process.pid}.log`),
	NODE_ENV: 'test'
})
