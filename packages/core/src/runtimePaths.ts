import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// src and dist have the same depth; defaults retain the pre-workspace layout.
export const repositoryRoot = fileURLToPath(
	new URL('../../../', import.meta.url)
)
export const defaultSettingsFile = join(repositoryRoot, '.env')
export const defaultDataDirectory = join(repositoryRoot, 'data')
export const defaultLogFile = join(repositoryRoot, 'logs', 'bot.log')
export const defaultRequestDumpDirectory = join(
	repositoryRoot,
	'logs',
	'ai-requests'
)
