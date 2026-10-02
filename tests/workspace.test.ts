import assert from 'node:assert/strict'
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import {
	cp,
	mkdir,
	mkdtemp,
	readFile,
	realpath,
	rm,
	stat,
	symlink,
	writeFile
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const repository = fileURLToPath(new URL('../', import.meta.url))

async function linkCoreDependencies(temporary: string) {
	const source = join(repository, 'packages/core')
	const manifest: { dependencies: Record<string, string> } = JSON.parse(
		await readFile(join(source, 'package.json'), 'utf8')
	)
	for (const name of Object.keys(manifest.dependencies)) {
		const destination = join(temporary, 'packages/core/node_modules', name)
		await mkdir(dirname(destination), { recursive: true })
		// Resolve each package first: relative pnpm symlinks must retain their
		// installed base when the copied workspace lives on another Windows drive.
		await symlink(
			name === '@voxel-pilot/contracts'
				? join(temporary, 'packages/contracts')
				: await realpath(join(source, 'node_modules', name)),
			destination,
			'junction'
		)
	}
}

test('built core imports are inert and explicit CLI bootstrap preserves root paths and temporary storage', async () => {
	const temporary = await mkdtemp(join(tmpdir(), 'voxel-pilot-workspace-'))
	try {
		for (const folder of ['packages/contracts', 'packages/core', 'apps/cli']) {
			await cp(
				join(repository, folder, 'dist'),
				join(temporary, folder, 'dist'),
				{ recursive: true }
			)
			await cp(
				join(repository, folder, 'package.json'),
				join(temporary, folder, 'package.json')
			)
		}
		await linkCoreDependencies(temporary)
		await mkdir(join(temporary, 'apps/cli/node_modules'), { recursive: true })
		await symlink(
			await realpath(join(repository, 'apps/cli/node_modules/dotenv')),
			join(temporary, 'apps/cli/node_modules/dotenv'),
			'junction'
		)
		for (const folder of [
			'node_modules/@voxel-pilot',
			'apps/cli/node_modules/@voxel-pilot'
		]) {
			await mkdir(join(temporary, folder), { recursive: true })
			await symlink(
				join(temporary, 'packages/core'),
				join(temporary, folder, 'core'),
				'junction'
			)
			await symlink(
				join(temporary, 'packages/contracts'),
				join(temporary, folder, 'contracts'),
				'junction'
			)
		}
		await writeFile(
			join(temporary, '.env'),
			[
				'MINECRAFT_HOST=localhost',
				'MINECRAFT_PORT=25565',
				'MINECRAFT_USERNAME=workspace-fixture',
				'MINECRAFT_VERSION=1.20.4',
				'AI_PROVIDER=disabled',
				'AI_MODEL=test-model',
				'LOG_LEVEL=info'
			].join('\n')
		)
		const environment = { ...process.env }
		for (const key of Object.keys(environment)) {
			if (/^(?:MINECRAFT_|AI_|LOG_|DOTENV_|ROUTERAI_)/.test(key))
				delete environment[key]
		}
		environment.NODE_ENV = 'test'
		const probe = `
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire, syncBuiltinESMExports } from 'node:module';
const require = createRequire(import.meta.url);
const net = require('node:net'), tls = require('node:tls');
net.Socket.prototype.connect = () => { throw new Error('network during core import/construction'); };
tls.connect = () => { throw new Error('TLS during core import/construction'); };
globalThis.fetch = () => { throw new Error('fetch during core import/construction'); };
const fs = require('node:fs');
let forbidResourceCreation = true;
const readFileSync = fs.readFileSync;
fs.readFileSync = (filename, ...options) => {
 if (forbidResourceCreation && filename === ${JSON.stringify(join(temporary, '.env'))}) throw new Error('settings read during core import/construction');
 return readFileSync(filename, ...options);
};
const runtimeArtifacts = () => ['data', 'logs'].map(directory => {
 const path = ${JSON.stringify(temporary)} + '/' + directory;
 return fs.existsSync(path) ? fs.readdirSync(path).sort() : null;
});
const beforeImportArtifacts = runtimeArtifacts();
const createWriteStream = fs.createWriteStream;
fs.createWriteStream = () => { throw new Error('log file during core import/construction'); };
const sqlite = require('node:sqlite');
const DatabaseSync = sqlite.DatabaseSync;
sqlite.DatabaseSync = new Proxy(DatabaseSync, { construct(target, argumentsList) {
 if (forbidResourceCreation) throw new Error('database during core import/construction');
 return Reflect.construct(target, argumentsList);
} });
syncBuiltinESMExports();
const { MinecraftBot, createBotRuntime } = await import('@voxel-pilot/core');
assert.deepEqual(Object.keys(await import('@voxel-pilot/contracts')), []);
const serviceApi = await import('@voxel-pilot/core/services');
for (const path of ['paths', 'schematic', 'hsm-diagram', 'agents-sdk-pilot']) await import('@voxel-pilot/core/' + path);
assert.equal(process.env.MINECRAFT_HOST, undefined);
import * as paths from '@voxel-pilot/core/paths';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
assert.equal(paths.repositoryRoot.replace(/[\\\\/]$/, ''), ${JSON.stringify(temporary)});
assert.equal(paths.defaultDataDirectory, join(paths.repositoryRoot, 'data'));
assert.equal(paths.defaultLogFile, join(paths.repositoryRoot, 'logs', 'bot.log'));
let options, disposed = 0, quits = 0, connections = 0;
const bot = Object.assign(new EventEmitter(), { quit() { quits++; } });
const config = serviceApi.createRuntimeConfigFromEnvironment({ MINECRAFT_HOST:'localhost', MINECRAFT_PORT:'25565', MINECRAFT_USERNAME:'explicit-fixture', MINECRAFT_VERSION:'1.20.4', AI_PROVIDER:'disabled', AI_MODEL:'fixture' }, {
 settingsFile:null, memoryDir:paths.defaultDataDirectory, profileDir:paths.defaultDataDirectory,
 logFile:paths.defaultLogFile, errorLogFile:join(paths.repositoryRoot,'logs/error.log'), aiRequestDumpDir:paths.defaultRequestDumpDirectory
});
const quiet = serviceApi.createRuntimeLogger({aiModel:config.ai.model, console:false, files:false});
const runtime = new MinecraftBot(serviceApi.createRuntimeServices({config,logger:quiet.logger}), {
 createBot(configuration) { connections++; options = configuration; return bot; },
 initConnection() { return () => { disposed++; }; }
});
assert.equal(connections,0);
assert.deepEqual(runtimeArtifacts(), beforeImportArtifacts);
const facade = createBotRuntime(serviceApi.createRuntimeServices({config,logger:quiet.logger}), {connection:{createBot(){throw new Error('facade construction connected');}}});
assert.deepEqual(Object.keys(facade).sort(), ['start','stop','telemetry']);
assert.equal(facade.telemetry.getSnapshot(), facade.telemetry.getSnapshot());
assert.equal(facade.telemetry.getSnapshot().health.value, null);
assert.deepEqual(runtimeArtifacts(), beforeImportArtifacts);
await assert.rejects(import('@voxel-pilot/core/legacy-logger'), {code:'ERR_PACKAGE_PATH_NOT_EXPORTED'});
fs.createWriteStream = createWriteStream;
forbidResourceCreation = false;
sqlite.DatabaseSync = DatabaseSync;
syncBuiltinESMExports();
runtime.start();
assert.equal(options.username, 'explicit-fixture');
await runtime.stop(); await runtime.stop();
await quiet.close();
assert.equal(quits, 1); assert.equal(disposed, 1);
const { createCliRuntime } = await import(pathToFileURL(join(paths.repositoryRoot,'apps/cli/dist/bootstrap.js')));
const app = createCliRuntime({ connection: {createBot(){ throw new Error('bootstrap must not start'); }, initConnection(){ throw new Error('bootstrap must not initialize'); }} });
assert.equal(app.services.config.minecraft.username, 'workspace-fixture');
assert.equal(app.services.config.paths.memoryDir, paths.defaultDataDirectory);
assert.equal(app.services.config.paths.profileDir, paths.defaultDataDirectory);
app.loggerHandle.logger.info('called bootstrap output');
await app.runtime.stop(); await app.loggerHandle.close();
// Tests may inspect storage owners; applications use only package exports.
const { MemoryManager } = await import(pathToFileURL(join(paths.repositoryRoot, 'packages/core/dist/core/memory/index.js')));
const { ProfileMemoryStore } = await import(pathToFileURL(join(paths.repositoryRoot, 'packages/core/dist/core/profile/index.js')));
const memory = new MemoryManager({ botName: 'workspace-fixture' });
const profile = new ProfileMemoryStore({ botName: 'workspace-fixture' });
await memory.load(); await memory.save(); memory.close();
await profile.load(); profile.close();
console.log('workspace-probe-ok');
`
		for (const directory of [temporary, join(temporary, 'apps/cli')]) {
			const result = spawnSync(
				process.execPath,
				['--input-type=module', '--eval', probe],
				{ cwd: directory, env: environment, encoding: 'utf8', timeout: 30_000 }
			)
			assert.equal(
				result.status,
				0,
				result.stderr || result.stdout || String(result.error)
			)
			assert.match(result.stdout, /workspace-probe-ok/)
		}
		for (const filename of [
			'data/bot_memory_workspace-fixture.db',
			'data/bot_profile_workspace-fixture.db',
			'logs/bot.log'
		]) {
			assert.ok((await stat(join(temporary, filename))).isFile(), filename)
		}
		const diagram = spawnSync(
			process.execPath,
			['./dist/commands/generateHsmDiagram.js'],
			{
				cwd: join(temporary, 'apps/cli'),
				env: environment,
				encoding: 'utf8',
				timeout: 15_000
			}
		)
		assert.equal(diagram.status, 0, diagram.stderr || diagram.stdout)
		assert.match(
			await readFile(
				join(temporary, 'docs/diagrams/xstate-machine.drawio'),
				'utf8'
			),
			/^<mxGraphModel\b/
		)
		const routerProbe = spawnSync(
			process.execPath,
			['./dist/commands/verifyAgentsSdkRouterAi.js'],
			{
				cwd: join(temporary, 'apps/cli'),
				env: environment,
				encoding: 'utf8',
				timeout: 15_000
			}
		)
		assert.equal(
			routerProbe.status,
			2,
			routerProbe.stderr || routerProbe.stdout
		)
		assert.match(routerProbe.stderr, /Live RouterAI check requires/)
		const schematic = spawnSync(
			process.execPath,
			['./dist/commands/inspectSchematic.js', 'absent.schem'],
			{
				cwd: join(temporary, 'apps/cli'),
				env: { ...environment, INIT_CWD: temporary },
				encoding: 'utf8',
				timeout: 15_000
			}
		)
		assert.equal(schematic.status, 1, schematic.stderr || schematic.stdout)
		assert.ok(
			schematic.stdout.includes(join(temporary, 'absent.schem')),
			schematic.stdout
		)
		const settings = await readFile(join(temporary, '.env'), 'utf8')
		assert.match(settings, /AI_PROVIDER=disabled/)
	} finally {
		assert.equal(dirname(resolve(temporary)), resolve(tmpdir()))
		assert.ok(temporary.includes('voxel-pilot-workspace-'))
		await rm(temporary, { recursive: true, force: true })
	}
})

test('built schematic command preserves usage without Minecraft or model requests', () => {
	const result = spawnSync(
		process.execPath,
		[
			'--import',
			'./packages/core/src/tests/setupEnv.mjs',
			'./apps/cli/dist/commands/inspectSchematic.js'
		],
		{ cwd: repository, encoding: 'utf8', timeout: 15_000 }
	)
	assert.equal(result.status, 1, result.stderr || String(result.error))
	assert.match(
		result.stdout + result.stderr,
		/Usage: pnpm run inspect-schematic/
	)
})

test('development exports and watcher restart on core source changes without starting a bot', async () => {
	const temporary = await mkdtemp(join(tmpdir(), 'voxel-pilot-watch-'))
	let child: ReturnType<typeof spawn> | undefined
	let finished = false
	let watchdog: ReturnType<typeof setTimeout> | undefined
	try {
		await cp(
			join(repository, 'packages/core/src'),
			join(temporary, 'packages/core/src'),
			{ recursive: true }
		)
		for (const filename of [
			'tsconfig.base.json',
			'packages/core/tsconfig.json',
			'packages/core/package.json'
		])
			await cp(join(repository, filename), join(temporary, filename))
		await linkCoreDependencies(temporary)
		await mkdir(join(temporary, 'apps/cli/node_modules/@voxel-pilot'), {
			recursive: true
		})
		await symlink(
			join(temporary, 'packages/core'),
			join(temporary, 'apps/cli/node_modules/@voxel-pilot/core'),
			'junction'
		)
		await mkdir(join(temporary, 'apps/cli/src'), { recursive: true })
		await writeFile(
			join(temporary, 'apps/cli/package.json'),
			'{"type":"module"}'
		)
		await writeFile(
			join(temporary, 'apps/cli/src/probe.ts'),
			"import { repositoryRoot } from '@voxel-pilot/core/paths'; console.log('watch-entry-ready', repositoryRoot)\n"
		)
		const manifest = JSON.parse(
			await readFile(join(repository, 'apps/cli/package.json'), 'utf8')
		)
		const argumentsFromScript: string[] = manifest.scripts.dev
			.match(/"[^"]*"|\S+/g)
			.slice(1)
			.map((value: string) => value.replace(/^"|"$/g, ''))
		argumentsFromScript[argumentsFromScript.length - 1] = 'src/probe.ts'
		child = spawn(
			process.execPath,
			[fileURLToPath(import.meta.resolve('tsx/cli')), ...argumentsFromScript],
			{
				cwd: join(temporary, 'apps/cli'),
				detached: process.platform !== 'win32',
				stdio: ['ignore', 'pipe', 'pipe']
			}
		)
		await new Promise<void>((resolveProbe, reject) => {
			let stdout = '',
				stderr = '',
				changed = false
			watchdog = setTimeout(
				() =>
					reject(new Error(`Watcher did not restart: ${stdout}\n${stderr}`)),
				30_000
			)
			child!.on('error', reject)
			child!.on('exit', code => {
				if (!finished)
					reject(new Error(`Watcher exited early (${code}): ${stderr}`))
			})
			child!.stderr!.on('data', chunk => {
				stderr += chunk.toString()
			})
			child!.stdout!.on('data', chunk => {
				stdout += chunk.toString()
				if (!changed && stdout.includes('watch-entry-ready')) {
					changed = true
					const filename = join(temporary, 'packages/core/src/runtimePaths.ts')
					void readFile(filename, 'utf8')
						.then(source =>
							writeFile(
								filename,
								source + "\nconsole.log('watch-source-updated')\n"
							)
						)
						.catch(reject)
				}
				if (
					stdout.includes('watch-source-updated') &&
					stdout.split('watch-entry-ready').length >= 3
				) {
					finished = true
					resolveProbe()
				}
			})
		})
	} finally {
		finished = true
		if (watchdog) clearTimeout(watchdog)
		if (child?.pid && child.exitCode === null) {
			if (process.platform === 'win32')
				execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
					stdio: 'ignore'
				})
			else process.kill(-child.pid, 'SIGTERM')
			await new Promise<void>(resolveExit =>
				child!.once('exit', () => resolveExit())
			)
		}
		assert.equal(dirname(resolve(temporary)), resolve(tmpdir()))
		assert.ok(temporary.includes('voxel-pilot-watch-'))
		await rm(temporary, { recursive: true, force: true })
	}
})
