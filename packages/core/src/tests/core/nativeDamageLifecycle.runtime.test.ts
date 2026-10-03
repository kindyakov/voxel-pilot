import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { setImmediate as flush } from 'node:timers/promises'

import { createBotRuntime } from '@/index.js'

import {
	createRuntimeConfigFromEnvironment,
	createRuntimeLogger,
	createRuntimeServices
} from '@/config/services.js'

import {
	type NativeDamageObservation,
	observeNativeDamage
} from '@/modules/connection/nativeDamage.js'

import { createRuntimeConnectionBot } from './fixtures/runtimeBot.js'

const require = createRequire(import.meta.url)

test('real runtime captures server damage registry before botReady and fences it at session disposal', async t => {
	t.mock.timers.enable({ apis: ['Date', 'setTimeout', 'setInterval'] })
	const directory = await mkdtemp(join(tmpdir(), 'vp-native-damage-'))
	const logging = createRuntimeLogger({
		aiModel: 'fixture',
		console: false,
		files: false
	})
	const config = createRuntimeConfigFromEnvironment(
		{
			MINECRAFT_HOST: 'localhost',
			MINECRAFT_PORT: '25565',
			MINECRAFT_USERNAME: 'native-damage-fixture',
			MINECRAFT_VERSION: '1.20.6',
			AI_PROVIDER: 'disabled',
			AI_MODEL: 'fixture'
		},
		{
			settingsFile: null,
			memoryDir: join(directory, 'memory'),
			profileDir: join(directory, 'profile'),
			logFile: join(directory, 'unused.log'),
			errorLogFile: join(directory, 'unused-error.log'),
			aiRequestDumpDir: join(directory, 'dumps')
		}
	)
	const bot = createRuntimeConnectionBot()
	bot.registry = require('minecraft-data')('1.20.6')
	bot.version = '1.20.6'
	require('mineflayer/lib/plugins/entities')(bot)
	Object.assign(bot.entities, { [bot.entity.id]: bot.entity })
	const runtime = createBotRuntime(
		createRuntimeServices({ config, logger: logging.logger }),
		{
			connection: {
				createBot: () => bot.asBot(),
				initConnection: () => () => {}
			}
		}
	)
	t.after(async () => {
		await runtime.stop()
		await logging.close()
		await rm(directory, { recursive: true, force: true })
	})
	runtime.start()
	bot._client.emit('registry_data', {
		id: 'minecraft:damage_type',
		entries: [
			{ key: 'minecraft:mob_attack', value: null },
			{ key: 'minecraft:arrow', value: null }
		]
	})
	const registryCallbacks = bot._client.listeners('registry_data')
	bot.emit('botReady')
	assert.equal(await bot.hsm.ready, true)
	await flush()
	const damages: NativeDamageObservation[] = []
	const stopReader = observeNativeDamage(bot.asBot(), damage =>
		damages.push(damage)
	)
	t.after(stopReader)
	const hit = {
		entityId: bot.entity.id,
		sourceTypeId: 1,
		sourceCauseId: 31,
		sourceDirectId: 41,
		sourcePosition: { x: 20, y: 64, z: 0 }
	}
	bot._client.emit('damage_event', hit)
	assert.equal(damages[0]?.ranged, true)
	assert.equal(damages[0]?.sourceId, 30)
	assert.equal(bot.hsm.getContext().lastDamage.sequence, 1)
	assert.equal(bot.hsm.getContext().lastDamage.sourceId, 30)
	const damageCallbacks = bot._client.listeners('damage_event')
	await runtime.stop()
	const count = damages.length
	for (const callback of registryCallbacks)
		callback({
			id: 'minecraft:damage_type',
			entries: [{ key: 'minecraft:arrow' }]
		})
	for (const callback of damageCallbacks) callback(hit)
	assert.equal(damages.length, count)
	stopReader()
	assert.equal(
		bot._client.listeners('registry_data').includes(registryCallbacks[0]!),
		false
	)
})
