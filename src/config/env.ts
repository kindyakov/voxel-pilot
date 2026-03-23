import Ajv from 'ajv'

const schema = {
	type: 'object',
	properties: {
		MINECRAFT_HOST: { type: 'string', minLength: 1 },
		MINECRAFT_PORT: { type: 'string', pattern: '^[0-9]+$' },
		MINECRAFT_USERNAME: { type: 'string', minLength: 1 },
		MINECRAFT_VERSION: { type: 'string', minLength: 1 },
		AI_PROVIDER: {
			type: 'string',
			enum: [
				'openai',
				'routerai',
				'openrouter',
				'openai_compatible',
				'local',
				'disabled'
			]
		},
		AI_MODEL: { type: 'string', minLength: 1 },
		AI_API_KEY: { type: 'string' },
		AI_TIMEOUT_MS: { type: 'string', pattern: '^[0-9]+$' },
		AI_MAX_TOKENS: { type: 'string', pattern: '^[0-9]+$' }
	},
	required: [
		'MINECRAFT_HOST',
		'MINECRAFT_PORT',
		'MINECRAFT_USERNAME',
		'MINECRAFT_VERSION',
		'AI_PROVIDER',
		'AI_MODEL'
	]
}

export function validateEnv() {
	const ajv = new Ajv({ allErrors: true, useDefaults: true })
	const validate = ajv.compile(schema)
	const valid = validate(process.env)

	if (!valid) {
		const errors = validate.errors
			?.map(err => `  - ${err.instancePath.replace('/', '')} ${err.message}`)
			.join('\n')
		throw new Error(`\n❌ Invalid environment variables:\n${errors}\n`)
	}

	return process.env as Record<string, string>
}
