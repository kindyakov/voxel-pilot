import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

test('built explicit AI and Minecraft adapters import without environment or runtime side effects', async () => {
	const temporary = await mkdtemp(join(tmpdir(), 'voxel-pilot-pure-adapters-'))
	const packageDirectory = fileURLToPath(new URL('../../../', import.meta.url))
	try {
		const modules = [
			'ai/loop.js',
			'ai/client.js',
			'modules/connection/runtimeConnection.js',
			'modules/plugins/viewer.js',
			'modules/plugins/webInventory.js',
			'utils/minecraft/botUtils.js'
		]
		const environment = { ...process.env }
		for (const key of Object.keys(environment))
			if (/^(?:MINECRAFT_|AI_|OPENAI_|LOG_|DOTENV_|ROUTERAI_)/.test(key))
				delete environment[key]
		const probe = `
import assert from 'node:assert/strict';
import { Server, Socket } from 'node:net';
Server.prototype.listen = function() { throw new Error('Unexpected server start'); };
Socket.prototype.connect = function() { throw new Error('Unexpected network connection'); };
globalThis.fetch = async function() { throw new Error('Unexpected model request'); };
const initial = process.getActiveResourcesInfo().sort();
for (const url of ${JSON.stringify(modules.map(name => pathToFileURL(join(packageDirectory, 'dist', name)).href))}) await import(url);
assert.deepEqual(process.getActiveResourcesInfo().sort(), initial);
console.log('pure-adapters-ok');
`
		const result = spawnSync(
			process.execPath,
			['--input-type=module', '--eval', probe],
			{ cwd: temporary, env: environment, encoding: 'utf8', timeout: 30_000 }
		)
		assert.equal(
			result.status,
			0,
			result.stderr || result.stdout || String(result.error)
		)
		assert.match(result.stdout, /pure-adapters-ok/)
		assert.deepEqual(await readdir(temporary), [])
	} finally {
		assert.equal(dirname(resolve(temporary)), resolve(tmpdir()))
		assert.ok(temporary.includes('voxel-pilot-pure-adapters-'))
		await rm(temporary, { recursive: true, force: true })
	}
})
