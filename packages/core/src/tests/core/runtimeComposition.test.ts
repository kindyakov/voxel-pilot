import assert from 'node:assert/strict'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
	type RuntimeLogRecord,
	createRuntimeConfigFromEnvironment,
	createRuntimeLogger,
	createRuntimeServices
} from '../../config/services.js'
import MinecraftBot from '../../core/bot.js'
import { createRuntimeConnectionBot } from './fixtures/runtimeBot.js'

function configAt(directory: string, username: string) {
	return createRuntimeConfigFromEnvironment(
		{
			MINECRAFT_HOST: 'localhost',
			MINECRAFT_PORT: '25565',
			MINECRAFT_USERNAME: username,
			MINECRAFT_VERSION: '1.20.4',
			AI_PROVIDER: 'disabled',
			AI_MODEL: username
		},
		{
			settingsFile: null,
			memoryDir: join(directory, 'memory'),
			profileDir: join(directory, 'profile'),
			logFile: join(directory, 'logs', 'bot.log'),
			errorLogFile: join(directory, 'logs', 'error.log'),
			aiRequestDumpDir: join(directory, 'logs', 'ai-requests')
		}
	)
}

test('construction is inert and independent runtimes retain their app-owned loggers', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'voxel-instance-composition-'))
	const firstRecords: RuntimeLogRecord[] = [],
		secondRecords: RuntimeLogRecord[] = []
	const handles = [firstRecords, secondRecords].map((records, index) =>
		createRuntimeLogger({
			aiModel: `model-${index}`,
			console: false,
			files: false,
			sink: { level: 'debug', write: record => records.push(record) }
		})
	)
	const configs = [
		configAt(join(directory, 'first'), 'first'),
		configAt(join(directory, 'second'), 'second')
	]
	const connections: ReturnType<typeof createRuntimeConnectionBot>[] = []
	const runtimes = handles.map(
		(handle, index) =>
			new MinecraftBot(
				createRuntimeServices({
					config: configs[index]!,
					logger: handle.logger
				}),
				{
					createBot: options => {
						const bot = createRuntimeConnectionBot(options.username)
						connections.push(bot)
						return bot.asBot()
					},
					initConnection: () => () => {}
				}
			)
	)
	try {
		assert.equal(connections.length, 0)
		assert.deepEqual(await readdir(directory), [])
		handles[0]!.logger.setCorrelationId('FIRST')
		runtimes[0]!.start()
		runtimes[1]!.start()
		assert.deepEqual(
			connections.map(bot => bot.username),
			['first', 'second']
		)
		assert.equal(firstRecords[0]?.correlationId, 'FIRST')
		assert.equal(secondRecords[0]?.correlationId, null)
		await runtimes[0]!.stop()
		assert.equal(connections[0]!.quitCalls, 1)
		assert.equal(connections[1]!.quitCalls, 0)
		handles[0]!.logger.info('caller logger remains open')
		assert.equal(firstRecords.at(-1)?.message, 'caller logger remains open')
		assert.deepEqual(await readdir(directory), [])
	} finally {
		await Promise.all(runtimes.map(runtime => runtime.stop()))
		await Promise.all(handles.map(handle => handle.close()))
		await rm(directory, { recursive: true, force: true })
	}
})

test('sequential runtimes reopen selected stores with memory, profile and suspended tasks preserved', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'voxel-sequential-runtime-'))
	const config = configAt(directory, 'persistent-fixture')
	const handles: ReturnType<typeof createRuntimeLogger>[] = []
	const runtimes: MinecraftBot[] = []
	const openRuntime = async () => {
		const handle = createRuntimeLogger({
			aiModel: config.ai.model,
			console: false,
			files: false
		})
		handles.push(handle)
		const bot = createRuntimeConnectionBot(config.minecraft.username)
		const runtime = new MinecraftBot(
			createRuntimeServices({ config, logger: handle.logger }),
			{
				createBot: () => bot.asBot(),
				initConnection: () => () => {}
			}
		)
		runtimes.push(runtime)
		runtime.start()
		bot.emit('botReady')
		assert.equal(await bot.hsm.ready, true)
		return { runtime, handle, bot: bot.asBot() }
	}
	try {
		const first = await openRuntime()
		const memory = first.bot.memory!
		const entry = memory.saveEntry({
			type: 'location',
			position: { x: 1, y: 64, z: 2 },
			tags: ['home'],
			description: 'fixture-home',
			data: {}
		})
		first.bot.profileMemory!.updateProfilePrompt({
			persona: 'fixture persona',
			defaultLanguage: 'ru'
		})
		const task = memory.createTask({
			kind: 'mining',
			blockName: 'iron_ore',
			total: 5
		})
		memory.updateTaskProgress(task.id, 2, { status: 'active' })
		await first.runtime.stop()
		await first.handle.close()
		const second = await openRuntime()
		assert.notEqual(second.bot.memory, memory)
		assert.equal(
			second.bot.memory!.readEntries({ queryTags: ['home'] })[0]?.id,
			entry.id
		)
		assert.equal(
			second.bot.profileMemory!.getProfilePrompt().persona,
			'fixture persona'
		)
		assert.equal(
			second.bot.profileMemory!.getProfilePrompt().defaultLanguage,
			'ru'
		)
		assert.equal(second.bot.memory!.getTask(task.id)?.status, 'suspended')
		assert.equal(second.bot.memory!.getTask(task.id)?.done, 2)
		assert.equal(second.bot.hsm.getContext().currentGoal, null)
		assert.equal(second.bot.hsm.getContext().taskData, null)
		assert.deepEqual((await readdir(directory)).sort(), ['memory', 'profile'])
		assert.ok(
			(await readdir(config.paths.memoryDir)).includes(
				'bot_memory_persistent-fixture.db'
			)
		)
		assert.ok(
			(await readdir(config.paths.profileDir)).includes(
				'bot_profile_persistent-fixture.db'
			)
		)
	} finally {
		for (const runtime of runtimes) await runtime.stop()
		for (const handle of handles) await handle.close()
		await rm(directory, { recursive: true, force: true })
	}
})
