import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { defaultSettingsFile } from '@voxel-pilot/core/paths'
import { parse } from 'dotenv'

export type EnvironmentSnapshot = Readonly<Record<string, string | undefined>>

/** Loading is explicit; an environment value takes precedence over the file. */
export function loadSettings(
	environment: EnvironmentSnapshot,
	settingsFile: string | null = environment.DOTENV_CONFIG_PATH
		? resolve(environment.DOTENV_CONFIG_PATH)
		: defaultSettingsFile
): { values: EnvironmentSnapshot; settingsFile: string | null } {
	let fileValues: Record<string, string> = {}
	if (settingsFile !== null) {
		settingsFile = resolve(settingsFile)
		try {
			fileValues = parse(readFileSync(settingsFile))
		} catch (error) {
			if (
				!(error instanceof Error) ||
				!('code' in error) ||
				error.code !== 'ENOENT'
			)
				throw error
		}
	}
	const values: Record<string, string | undefined> = { ...fileValues }
	for (const [key, value] of Object.entries(environment)) {
		if (value !== undefined) values[key] = value
	}
	return { values: Object.freeze(values), settingsFile }
}
