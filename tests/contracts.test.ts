import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

test('built contracts import independently and declarations compile in a browser without Node types', async () => {
	const root = fileURLToPath(new URL('../', import.meta.url))
	const directory = await mkdtemp(join(tmpdir(), 'voxel-browser-contracts-'))
	try {
		const js = await readFile(
			join(root, 'packages/contracts/dist/index.js'),
			'utf8'
		)
		assert.equal(js.trim(), 'export {};')
		const imported = spawnSync(
			process.execPath,
			[
				'--input-type=module',
				'--eval',
				`await import(${JSON.stringify(new URL('../packages/contracts/dist/index.js', import.meta.url).href)}); console.log('portable-contracts-ok')`
			],
			{ cwd: directory, encoding: 'utf8', timeout: 5000 }
		)
		assert.equal(imported.status, 0, imported.stderr)
		assert.match(imported.stdout, /portable-contracts-ok/)
		await writeFile(
			join(directory, 'contracts.d.ts'),
			await readFile(join(root, 'packages/contracts/dist/index.d.ts'))
		)
		await writeFile(
			join(directory, 'consumer.ts'),
			`import type { BotRuntime, BotSnapshot, StopResult } from './contracts.js';
declare const runtime: BotRuntime;
const snapshot: BotSnapshot = runtime.telemetry.getSnapshot();
runtime.telemetry.subscribe(value => { document.title = value.connection.state; });
const stopped: Promise<StopResult> = runtime.stop(); void stopped; void snapshot;
// @ts-expect-error Native Node globals are absent in this browser consumer.
process.exit();
// @ts-expect-error Portable runtime does not lend native Bot or actor handles.
runtime.getBot();`
		)
		await writeFile(
			join(directory, 'tsconfig.json'),
			JSON.stringify({
				compilerOptions: {
					strict: true,
					noEmit: true,
					types: [],
					lib: ['ES2022', 'DOM'],
					module: 'ESNext',
					moduleResolution: 'bundler'
				},
				include: ['consumer.ts', 'contracts.d.ts']
			})
		)
		const compiled = spawnSync(
			process.execPath,
			[
				join(root, 'node_modules/typescript/bin/tsc'),
				'--project',
				join(directory, 'tsconfig.json')
			],
			{ cwd: directory, encoding: 'utf8', timeout: 15_000 }
		)
		assert.equal(
			compiled.status,
			0,
			compiled.stdout || compiled.stderr || String(compiled.error)
		)
	} finally {
		await rm(directory, { recursive: true, force: true })
	}
})
