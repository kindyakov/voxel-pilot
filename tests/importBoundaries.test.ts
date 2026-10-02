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
			'packages/contracts/src',
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
		const contracts = {
			name: '@voxel-pilot/contracts',
			exports: { '.': './src/index.ts' }
		}
		await writeFile(
			join(directory, 'packages/contracts/package.json'),
			JSON.stringify(contracts)
		)
		await writeFile(
			join(directory, 'packages/contracts/src/index.ts'),
			'export interface Snapshot { readonly value: number | null }'
		)
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
		for (const source of [
			"import type { Bot } from 'mineflayer';",
			"import { readFile } from 'node:fs';",
			"import type { ReactNode } from 'react';",
			"import * as core from '@voxel-pilot/core';"
		]) {
			await writeFile(
				join(directory, 'packages/contracts/src/index.ts'),
				source
			)
			assert.match(check().stderr, /contracts must use portable local types/)
		}
		await writeFile(
			join(directory, 'packages/contracts/src/index.ts'),
			'export const portable = true;'
		)
		await writeFile(
			join(directory, 'packages/contracts/package.json'),
			JSON.stringify({
				...contracts,
				dependencies: { '@voxel-pilot/core': 'workspace:*' }
			})
		)
		assert.match(check().stderr, /contracts must be independent/)
		await writeFile(
			join(directory, 'packages/contracts/package.json'),
			JSON.stringify({
				...contracts,
				devDependencies: { '@types/node': 'fixture' }
			})
		)
		assert.match(check().stderr, /nonportable contracts dependency/)
	} finally {
		assert.equal(dirname(resolve(directory)), resolve(tmpdir()))
		await rm(directory, { recursive: true, force: true })
	}
})

test('AST checker enforces TUI ownership across static/type/export/dynamic imports and shared app composition', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'voxel-tui-boundaries-'))
	const manifests = {
		'packages/contracts': {
			name: '@voxel-pilot/contracts',
			exports: { '.': './src/index.ts' }
		},
		'packages/core': {
			name: '@voxel-pilot/core',
			exports: { '.': './src/index.ts' }
		},
		'packages/application': {
			name: '@voxel-pilot/application',
			exports: { '.': './src/index.ts' },
			dependencies: { '@voxel-pilot/tui': 'workspace:*' }
		},
		'packages/presentation': {
			name: '@voxel-pilot/presentation',
			exports: { '.': './src/index.ts' },
			dependencies: {
				'@voxel-pilot/contracts': 'workspace:*',
				'@voxel-pilot/core': 'workspace:*',
				react: 'fixture'
			}
		},
		'apps/cli': {
			name: '@voxel-pilot/cli',
			exports: { '.': './src/index.ts' },
			dependencies: { '@voxel-pilot/application': 'workspace:*' }
		},
		'apps/tui': {
			name: '@voxel-pilot/tui',
			exports: { '.': './src/app/application.tsx' },
			dependencies: {
				'@voxel-pilot/contracts': 'workspace:*',
				'@voxel-pilot/core': 'workspace:*',
				'@voxel-pilot/application': 'workspace:*',
				react: 'fixture',
				ink: 'fixture'
			}
		}
	}
	try {
		await mkdir(join(directory, 'scripts'), { recursive: true })
		await mkdir(join(directory, 'node_modules'), { recursive: true })
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
		for (const [folder, manifest] of Object.entries(manifests)) {
			await mkdir(join(directory, folder, 'src'), { recursive: true })
			await writeFile(
				join(directory, folder, 'package.json'),
				JSON.stringify(manifest)
			)
			await writeFile(
				join(directory, folder, 'src/index.ts'),
				'export const value = 1;'
			)
		}
		const write = async (file: string, source: string) => {
			await mkdir(dirname(join(directory, file)), { recursive: true })
			await writeFile(join(directory, file), source)
		}
		await write(
			'apps/tui/src/app/bootstrap.ts',
			"import * as app from '@voxel-pilot/application'; void app;"
		)
		await write(
			'apps/tui/src/features/logs/index.tsx',
			"import type {Snapshot} from '@voxel-pilot/contracts'; import {value} from '../connection/index.js';"
		)
		await write(
			'apps/tui/src/features/connection/index.tsx',
			'export const value=1;'
		)
		const check = () =>
			spawnSync(process.execPath, ['./scripts/check-imports.mjs'], {
				cwd: directory,
				encoding: 'utf8',
				timeout: 15000
			})
		assert.equal(check().status, 0)
		for (const [file, source, expected] of [
			[
				'apps/tui/src/ui/probe.tsx',
				"import type {View} from '../features/logs/index.js';",
				/independent TUI UI/
			],
			[
				'apps/tui/src/ui/probe.tsx',
				"export {view} from '../runtime/telemetryStore.js';",
				/independent TUI UI/
			],
			[
				'apps/tui/src/features/logs/probe.ts',
				"const app=import('../../app/bootstrap.js');",
				/reusable module imports composition/
			],
			[
				'apps/tui/src/runtime/probe.ts',
				"export * from '../app/application.js';",
				/reusable module imports composition/
			],
			[
				'apps/tui/src/terminal/probe.ts',
				"const source=require('../runtime/store.js');",
				/terminal imports runtime/
			],
			[
				'apps/tui/src/runtime/probe.ts',
				"import {view} from '../features/logs/index.js';",
				/runtime bridge imports display/
			],
			[
				'apps/tui/src/features/logs/probe.ts',
				"import type {Bot} from '@voxel-pilot/core';",
				/runtime dependency outside composition/
			],
			[
				'apps/tui/src/ui/probe.tsx',
				"export * from '@voxel-pilot/application';",
				/runtime dependency outside composition/
			],
			[
				'apps/tui/src/features/logs/probe.ts',
				"import {privateView} from '../connection/private.js';",
				/sibling feature requires public index/
			],
			[
				'apps/tui/src/ui/probe.tsx',
				'const environment=process.env;',
				/reusable module reads process.env/
			],
			[
				'apps/tui/src/app/probe.ts',
				"import core from '@voxel-pilot/core/private';",
				/private workspace import/
			],
			[
				'apps/cli/src/probe.ts',
				"import * as app from '@voxel-pilot/application';",
				/CLI application dependency outside composition/
			],
			[
				'packages/presentation/src/probe.ts',
				"import type {Runtime} from '@voxel-pilot/core';",
				/presentation must remain portable/
			],
			[
				'packages/presentation/src/probe.ts',
				"export * from 'react';",
				/presentation must remain portable/
			],
			[
				'packages/application/src/probe.ts',
				"import * as tui from '@voxel-pilot/tui';",
				/library workspace imports application/
			]
		] as const) {
			await write(file, source)
			const rejected = check()
			assert.notEqual(rejected.status, 0, source)
			assert.match(rejected.stderr, expected)
			await write(file, 'export const valid=1;')
		}
		assert.equal(check().status, 0)
	} finally {
		assert.equal(dirname(resolve(directory)), resolve(tmpdir()))
		await rm(directory, { recursive: true, force: true })
	}
})
