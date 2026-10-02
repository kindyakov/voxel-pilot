import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
	cp,
	mkdir,
	mkdtemp,
	realpath,
	rm,
	symlink,
	writeFile
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const repository = fileURLToPath(new URL('../', import.meta.url))

test('import checker enforces explicit core settings and public app boundaries', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'voxel-import-boundaries-'))
	try {
		for (const path of [
			'scripts',
			'packages/core/src',
			'apps/cli/src',
			'node_modules'
		])
			await mkdir(join(directory, path), { recursive: true })
		await cp(
			join(repository, 'scripts/check-imports.mjs'),
			join(directory, 'scripts/check-imports.mjs')
		)
		await writeFile(join(directory, 'package.json'), '{"type":"module"}')
		await symlink(
			await realpath(join(repository, 'node_modules/typescript')),
			join(directory, 'node_modules/typescript'),
			'junction'
		)
		const core = {
			name: '@voxel-pilot/core',
			exports: { '.': './src/index.ts' },
			dependencies: {}
		}
		await writeFile(
			join(directory, 'packages/core/package.json'),
			JSON.stringify(core)
		)
		await writeFile(
			join(directory, 'apps/cli/package.json'),
			JSON.stringify({
				name: '@voxel-pilot/cli',
				exports: { '.': './src/index.ts' },
				dependencies: { '@voxel-pilot/core': 'workspace:*' }
			})
		)
		await writeFile(
			join(directory, 'packages/core/src/index.ts'),
			'export const configFromValues = values => Object.freeze({...values});'
		)
		await writeFile(
			join(directory, 'apps/cli/src/index.ts'),
			"import * as core from '@voxel-pilot/core'; void core;"
		)
		const check = () =>
			spawnSync(process.execPath, ['./scripts/check-imports.mjs'], {
				cwd: directory,
				encoding: 'utf8',
				timeout: 15000
			})
		const valid = check()
		assert.equal(valid.status, 0, valid.stderr || String(valid.error))
		for (const [source, expected] of [
			["import Logger from '@/config/logger.js';", /removed singleton entry/],
			['const config = process.env;', /core reads process.env/],
			[
				"import app from '@voxel-pilot/cli';",
				/core workspace dependency must be portable contracts/
			]
		] as const) {
			await writeFile(
				join(directory, 'packages/core/package.json'),
				JSON.stringify({
					...core,
					dependencies: { '@voxel-pilot/cli': 'workspace:*' }
				})
			)
			await writeFile(join(directory, 'packages/core/src/index.ts'), source)
			const rejected = check()
			assert.notEqual(rejected.status, 0)
			assert.match(rejected.stderr, expected)
		}
		await writeFile(
			join(directory, 'packages/core/src/index.ts'),
			'export const pure = true;'
		)
		await writeFile(
			join(directory, 'packages/core/package.json'),
			JSON.stringify({ ...core, dependencies: { dotenv: 'fixture' } })
		)
		assert.match(check().stderr, /app-owned dependency in core: dotenv/)
		await writeFile(
			join(directory, 'packages/core/package.json'),
			JSON.stringify(core)
		)
		await writeFile(
			join(directory, 'apps/cli/src/index.ts'),
			"import core from '@voxel-pilot/core/private';"
		)
		assert.match(check().stderr, /private workspace import/)
		await writeFile(
			join(directory, 'apps/cli/src/index.ts'),
			"import core from '../../../packages/core/src/index.js';"
		)
		assert.match(check().stderr, /relative import crosses package boundary/)
	} finally {
		assert.equal(dirname(resolve(directory)), resolve(tmpdir()))
		await rm(directory, { recursive: true, force: true })
	}
})
