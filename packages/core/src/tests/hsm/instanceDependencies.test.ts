import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { setImmediate as flush } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

import { createActor, fromPromise } from 'xstate'

import { createRuntimeLogger } from '@/config/runtimeLogger.js'
import type { RuntimeLogRecord } from '@/config/runtimeLogger.js'

import BotStateMachine from '@/core/harness.js'
import { MemoryManager } from '@/core/memory/index.js'

import type { HarnessDependencies } from '@/hsm/dependencies.js'
import { createBotMachine } from '@/hsm/machine.js'
import type { MachineFactoryOptions } from '@/hsm/machine.js'

import type {
	AgentTurnInput,
	AgentTurnResult
} from '@/ai/contracts/agentTurn.js'

import {
	canAttackEnemy,
	cleanupPathfindCache,
	clearPathfindCache
} from '@/utils/combat/enemyVisibility.js'

import { createHarness } from './fixtures/handoffBot.js'

const loggerFixture = (t: test.TestContext, id: string) => {
	const records: RuntimeLogRecord[] = []
	const handle = createRuntimeLogger({
		aiModel: id,
		console: false,
		files: false,
		sink: { level: 'debug', write: record => records.push(record) }
	})
	handle.logger.setCorrelationId(id)
	t.after(() => handle.close())
	return { logger: handle.logger, records }
}

const dependencies = (
	logger: HarnessDependencies['logger'],
	overrides: Partial<HarnessDependencies> = {}
): HarnessDependencies => ({
	logger,
	runAgentTurn: async () => ({
		kind: 'finish',
		message: 'Done',
		transcript: []
	}),
	aiPilotEnabled: true,
	minecraftVersion: '1.20.4',
	diagnosticsEnabled: false,
	...overrides
})

const ownerBot = (t: test.TestContext, services: HarnessDependencies) => {
	const { bot, actor, enemy } = createHarness(false, '1.20.4', services)
	actor.stop()
	const memory = new MemoryManager({
		botName: bot.username,
		dataDir: join(tmpdir(), 'voxel-hsm-dependency-fixture')
	})
	bot.asBot().memory = memory
	t.mock.method(memory, 'load', async () => {})
	t.mock.method(memory, 'save', async () => {})
	t.mock.method(memory, 'close', () => {})
	return { bot, enemy }
}

const machineActor = (
	t: test.TestContext,
	services: HarnessDependencies,
	options: MachineFactoryOptions = {}
) => {
	const { bot } = ownerBot(t, services)
	const actor = createActor(
		createBotMachine(services, {
			...options,
			actors: {
				serviceEntitiesTracking: fromPromise(async () => {}),
				worldObservation: fromPromise(async () => {}),
				...options.actors
			}
		}),
		{ input: { bot: bot.asBot() } }
	)
	bot.hsm = { getContext: () => actor.getSnapshot().context } as typeof bot.hsm
	actor.start()
	t.after(() => actor.stop())
	return { actor, bot }
}

test('machine factories bind independent runners, logger contexts and client overrides', async t => {
	const firstLog = loggerFixture(t, 'FIRST')
	const secondLog = loggerFixture(t, 'SECOND')
	const firstInputs: AgentTurnInput[] = []
	const secondInputs: AgentTurnInput[] = []
	let resolveFirst!: (result: AgentTurnResult) => void
	const delayed = new Promise<AgentTurnResult>(resolve => {
		resolveFirst = resolve
	})
	const first = machineActor(
		t,
		dependencies(firstLog.logger, {
			runAgentTurn: input => {
				firstInputs.push(input)
				return delayed
			}
		})
	)
	const client = {
		createResponse: async () => ({
			id: 'override',
			outputText: '',
			toolCalls: []
		})
	}
	const second = machineActor(
		t,
		dependencies(secondLog.logger, {
			runAgentTurn: async input => {
				secondInputs.push(input)
				return { kind: 'finish', message: 'Second done', transcript: [] }
			}
		}),
		{ agentClient: client }
	)
	first.actor.send({
		type: 'USER_COMMAND',
		username: 'Pilot',
		text: 'First goal'
	})
	second.actor.send({
		type: 'USER_COMMAND',
		username: 'Pilot',
		text: 'Second goal'
	})
	await flush()
	assert.equal(firstInputs.length, 1)
	assert.equal(secondInputs.length, 1)
	assert.equal(firstInputs[0]?.bot, first.bot.asBot())
	assert.equal(firstInputs[0]?.currentGoal, 'First goal')
	assert.equal(firstInputs[0]?.client, undefined)
	assert.equal(secondInputs[0]?.bot, second.bot.asBot())
	assert.equal(secondInputs[0]?.client, client)
	assert.equal(second.actor.getSnapshot().context.currentGoal, null)
	first.actor.stop()
	assert.equal(firstInputs[0]?.signal?.aborted, true)
	const firstLogCount = firstLog.records.length
	resolveFirst({ kind: 'finish', message: 'Late first reply', transcript: [] })
	await flush()
	assert.equal(firstLog.records.length, firstLogCount)
	assert.ok(
		!first.bot.chatMessages.some(message =>
			message.includes('Late first reply')
		)
	)
	second.actor.send({
		type: 'USER_COMMAND',
		username: 'Pilot',
		text: 'Next goal'
	})
	await flush()
	assert.equal(secondInputs.length, 2)
	assert.ok(firstLog.records.every(record => record.correlationId === 'FIRST'))
	assert.ok(
		secondLog.records.every(record => record.correlationId === 'SECOND')
	)
	assert.ok(
		secondLog.records.some(record => record.meta.message === 'Second done')
	)
	assert.ok(
		!firstLog.records.some(record => record.meta.message === 'Second done')
	)
})

test('an explicit disabled pilot pauses commands and preserves physical self defense', async t => {
	const { logger } = loggerFixture(t, 'DISABLED')
	let turns = 0
	const { bot, enemy } = ownerBot(
		t,
		dependencies(logger, { aiPilotEnabled: false })
	)
	const hsm = new BotStateMachine(
		bot.asBot(),
		dependencies(logger, {
			aiPilotEnabled: false,
			runAgentTurn: async () => {
				turns++
				return {
					kind: 'failed',
					reason: 'AI is disabled',
					transcript: [],
					isTransport: true
				}
			}
		})
	)
	t.after(() => hsm.stop())
	assert.equal(await hsm.ready, true)
	hsm.send({ type: 'USER_COMMAND', username: 'Pilot', text: 'Keep this goal' })
	await flush()
	assert.equal(turns, 1)
	assert.equal(hsm.getContext().pausedGoal, 'Keep this goal')
	hsm.resumePausedGoal()
	await flush()
	assert.equal(turns, 1, 'the disabled flag prevents resuming the paused pilot')
	hsm.send({ type: 'START_COMBAT', target: enemy })
	await flush()
	bot.emit('physicsTick')
	await flush()
	assert.ok(hsm.isInState({ MAIN_ACTIVITY: 'COMBAT' }))
	assert.equal(bot.pvp.target?.id, enemy.id)
	assert.equal(turns, 1)
})

test('the lifecycle owner opts into detailed diagnostics per instance and disposes its observer', async t => {
	t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] })
	const silent = loggerFixture(t, 'SILENT')
	const detailed = loggerFixture(t, 'DETAILED')
	const silentServices = dependencies(silent.logger)
	const detailedServices = dependencies(detailed.logger, {
		diagnosticsEnabled: true,
		minecraftVersion: 'explicit-version'
	})
	const first = ownerBot(t, silentServices)
	const second = ownerBot(t, detailedServices)
	const firstHsm = new BotStateMachine(first.bot.asBot(), silentServices)
	const secondHsm = new BotStateMachine(second.bot.asBot(), detailedServices)
	t.after(() => firstHsm.stop())
	t.after(() => secondHsm.stop())
	assert.deepEqual(await Promise.all([firstHsm.ready, secondHsm.ready]), [
		true,
		true
	])
	const runtime = detailed.records.find(
		record => record.message === '[HSM] runtime'
	)
	assert.equal(runtime?.meta.configuredMinecraftVersion, 'explicit-version')
	t.mock.timers.tick(5000)
	await flush()
	assert.equal(
		silent.records.filter(record => record.message === '[HSM] heartbeat')
			.length,
		0
	)
	assert.equal(
		silent.records.filter(record => record.message === '[HSM] runtime').length,
		0
	)
	assert.equal(
		detailed.records.filter(record => record.message === '[HSM] heartbeat')
			.length,
		1
	)
	await secondHsm.stop()
	const detailedCount = detailed.records.length
	first.bot.emit('health')
	t.mock.timers.tick(15000)
	await flush()
	assert.equal(detailed.records.length, detailedCount)
	assert.equal(firstHsm.getContext().health, first.bot.health)
	assert.ok(
		detailed.records.every(record => record.correlationId === 'DETAILED')
	)
})

test('reachability caches and cleanup are isolated for equal entity ids on separate bots', async t => {
	t.mock.timers.enable({ apis: ['Date'] })
	const firstLog = loggerFixture(t, 'FIRST')
	const secondLog = loggerFixture(t, 'SECOND')
	const first = ownerBot(t, dependencies(firstLog.logger))
	const second = ownerBot(t, dependencies(secondLog.logger))
	first.bot.solidAt = () => true
	second.bot.solidAt = () => true
	const firstPath = t.mock.method(
		first.bot.pathfinder,
		'getPathFromTo',
		function* () {
			yield { result: { status: 'noPath', path: [] } }
		}
	)
	const secondPath = t.mock.method(
		second.bot.pathfinder,
		'getPathFromTo',
		function* () {
			yield { result: { status: 'success', path: [{ x: 1, y: 64, z: 0 }] } }
		}
	)
	const reachable = (
		instance: typeof first,
		logger: HarnessDependencies['logger']
	) =>
		canAttackEnemy(
			instance.bot.asBot(),
			instance.enemy,
			32,
			50,
			1000,
			false,
			logger
		)
	assert.equal(await reachable(first, firstLog.logger), false)
	assert.equal(await reachable(second, secondLog.logger), true)
	assert.equal(await reachable(first, firstLog.logger), false)
	assert.equal(firstPath.mock.callCount(), 1)
	assert.equal(secondPath.mock.callCount(), 1)
	clearPathfindCache(first.bot.asBot())
	assert.equal(await reachable(first, firstLog.logger), false)
	assert.equal(await reachable(second, secondLog.logger), true)
	assert.equal(firstPath.mock.callCount(), 2)
	assert.equal(secondPath.mock.callCount(), 1)
	t.mock.timers.tick(6000)
	cleanupPathfindCache(first.bot.asBot(), firstLog.logger)
	assert.ok(
		firstLog.records.some(record =>
			record.message.includes('cleanupPathfindCache')
		)
	)
	assert.ok(
		!secondLog.records.some(record =>
			record.message.includes('cleanupPathfindCache')
		)
	)
	clearPathfindCache(first.bot.asBot())
	clearPathfindCache(second.bot.asBot())
})

test('pure HSM imports and factory construction neither load environment nor start runtime', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'voxel-hsm-import-'))
	try {
		await writeFile(
			join(directory, '.env'),
			'IMPORT_ENV_MARKER=must-not-load\n'
		)
		const machineUrl = new URL('../../hsm/machine.ts', import.meta.url).href
		const harnessUrl = new URL('../../core/harness.ts', import.meta.url).href
		const servicesUrl = new URL('../../config/services.ts', import.meta.url)
			.href
		const diagramUrl = new URL(
			'../../hsm/utils/hsmDrawioDiagram.ts',
			import.meta.url
		).href
		const source = `
			const {createBotMachine} = await import(${JSON.stringify(machineUrl)});
			await import(${JSON.stringify(harnessUrl)});
			const {createRuntimeLogger} = await import(${JSON.stringify(servicesUrl)});
			const {buildHsmDrawioDiagram} = await import(${JSON.stringify(diagramUrl)});
			const handle = createRuntimeLogger({aiModel:'fixture',console:false,files:false});
			createBotMachine({logger:handle.logger, runAgentTurn:async()=>{throw new Error('must not run')},aiPilotEnabled:false,minecraftVersion:'fixture',diagnosticsEnabled:false});
			if (!buildHsmDrawioDiagram().xml.includes('mxGraphModel')) throw new Error('missing diagram');
			await handle.close();
			if (process.env.IMPORT_ENV_MARKER) throw new Error('env was loaded');
			process.stdout.write('safe HSM import');
		`
		const env = Object.fromEntries(
			['PATH', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP'].flatMap(key =>
				process.env[key] ? [[key, process.env[key]!]] : []
			)
		)
		const output = execFileSync(
			process.execPath,
			[
				'--import',
				import.meta.resolve('tsx'),
				'--input-type=module',
				'--eval',
				source
			],
			{
				cwd: directory,
				env: {
					...env,
					TSX_TSCONFIG_PATH: fileURLToPath(
						new URL('../../../tsconfig.json', import.meta.url)
					)
				},
				encoding: 'utf8',
				timeout: 10000
			}
		)
		assert.equal(output, 'safe HSM import')
		assert.deepEqual(await readdir(directory), ['.env'])
	} finally {
		await rm(directory, { recursive: true, force: true })
	}
})
