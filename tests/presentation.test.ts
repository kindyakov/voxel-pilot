import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

test('built public presentation executes without Node globals and declarations compile for a browser', async () => {
	const root = fileURLToPath(new URL('../', import.meta.url))
	const directory = await mkdtemp(join(tmpdir(), 'voxel-browser-presentation-'))
	try {
		for (const name of ['contracts', 'presentation']) {
			const destination = join(directory, 'node_modules/@voxel-pilot', name)
			await mkdir(destination, { recursive: true })
			await cp(
				join(root, 'packages', name, 'package.json'),
				join(destination, 'package.json')
			)
			await cp(
				join(root, 'packages', name, 'dist'),
				join(destination, 'dist'),
				{ recursive: true }
			)
		}
		await writeFile(join(directory, 'package.json'), '{"type":"module"}')
		const probe = `
import assert from 'node:assert/strict';
const output = console.log.bind(console);
Object.defineProperty(globalThis, 'process', {get(){throw new Error('Node global in portable model');}});
Object.defineProperty(globalThis, 'Buffer', {get(){throw new Error('Node bytes in portable model');}});
globalThis.fetch = () => {throw new Error('network in portable model');};
globalThis.setTimeout = () => {throw new Error('timer in portable model');};
const {createLogView} = await import('@voxel-pilot/presentation');
const history = Object.freeze({id:'browser',revision:0,level:'debug',limits:{maxEntries:2,maxBytes:1000,maxEntryBytes:500},entries:[],stats:{retainedEntries:0,retainedBytes:0,acceptedEntries:0,acceptedByLevel:{debug:0,info:0,warn:0,error:0},evictedEntries:0,evictedBytes:0,truncatedEntries:0}});
const model = createLogView(history);
assert.equal(model.getSnapshot().mode,'live');
assert.equal(model.toggleDebug().includeDebug,true);
assert.equal(model.receive(history),model.getSnapshot());
assert(Object.isFrozen(model));
output('portable-presentation-ok');`
		const imported = spawnSync(
			process.execPath,
			['--input-type=module', '--eval', probe],
			{
				cwd: directory,
				encoding: 'utf8',
				timeout: 5000
			}
		)
		assert.equal(imported.status, 0, imported.stderr || String(imported.error))
		assert.match(imported.stdout, /portable-presentation-ok/)
		await writeFile(
			join(directory, 'consumer.ts'),
			`
import {createLogView, type LogView, type LogViewSnapshot} from '@voxel-pilot/presentation';
import type {LogHistory} from '@voxel-pilot/contracts';
declare const history: LogHistory;
const model:LogView = createLogView(history);
const view:LogViewSnapshot = model.scroll(-1);
document.title = view.mode;
model.receive(history); model.toggleDebug(); model.goLive();
// @ts-expect-error Model does not expose the source runtime or actor.
model.runtime.start();
// @ts-expect-error Source projection is immutable.
view.entries.push(history.entries[0]!);
// @ts-expect-error Portable declarations do not add Node globals.
process.exit();
// @ts-expect-error Portable declarations do not add Node byte types.
const bytes:Buffer = new Uint8Array();`
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
				include: ['consumer.ts']
			})
		)
		const compiled = spawnSync(
			process.execPath,
			[
				join(root, 'node_modules/typescript/bin/tsc'),
				'--project',
				join(directory, 'tsconfig.json')
			],
			{
				cwd: directory,
				encoding: 'utf8',
				timeout: 15000
			}
		)
		assert.equal(
			compiled.status,
			0,
			compiled.stdout || compiled.stderr || String(compiled.error)
		)
	} finally {
		assert.equal(dirname(resolve(directory)), resolve(tmpdir()))
		assert.match(directory, /voxel-browser-presentation-/)
		await rm(directory, { recursive: true, force: true })
	}
})
