import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { setImmediate as flush } from 'node:timers/promises'

import { Responses } from 'openai/resources/responses/responses'
import { Vec3 } from 'vec3'

import {
	createRuntimeConfigFromEnvironment,
	createRuntimeLogger,
	createRuntimeServices
} from '../../config/services.js'
import { createBotRuntime } from '../../index.js'
import { ItemFactory, createEntityFixture } from '../hsm/fixtures/handoffBot.js'
import { createRuntimeConnectionBot } from './fixtures/runtimeBot.js'

const require = createRequire(import.meta.url)
const minecraftData = require('minecraft-data')

async function fixture(
	t: test.TestContext,
	options: {
		ai?: boolean
		version?: string
		entitiesPlugin?: boolean
		endpoint?: string
		deferredRegistry?: boolean
	} = {}
) {
	const { ai = false, version = '1.20.4' } = options
	t.mock.timers.enable({
		apis: ['Date', 'setTimeout', 'setInterval'],
		now: 1000
	})
	const directory = await mkdtemp(join(tmpdir(), 'vp-telemetry-'))
	const handle = createRuntimeLogger({
		aiModel: 'fixture',
		console: false,
		files: false
	})
	const config = createRuntimeConfigFromEnvironment(
		{
			MINECRAFT_HOST: 'localhost',
			MINECRAFT_PORT: '25565',
			MINECRAFT_USERNAME: 'telemetry-fixture',
			MINECRAFT_VERSION: '1.20.4',
			AI_PROVIDER: ai ? 'openai' : 'disabled',
			AI_MODEL: 'fixture',
			AI_API_KEY: 'fixture-secret-token',
			AI_BASE_URL: options.endpoint ?? 'https://fixture.invalid/v1'
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
	const bots: ReturnType<typeof createRuntimeConnectionBot>[] = []
	const runtime = createBotRuntime(
		createRuntimeServices({ config, logger: handle.logger }),
		{
			connection: {
				createBot() {
					const bot = createRuntimeConnectionBot()
					bot.registry = minecraftData(version)
					bot.version = version
					if (options.entitiesPlugin)
						require('mineflayer/lib/plugins/entities')(bot.asBot())
					if (options.deferredRegistry) Reflect.deleteProperty(bot, 'registry')
					bots.push(bot)
					return bot.asBot()
				},
				initConnection: () => () => {}
			}
		}
	)
	t.after(async () => {
		await runtime.stop()
		await handle.close()
		await rm(directory, { recursive: true, force: true })
	})
	return { runtime, bots }
}

test('public measurements require native observations, preserve zero and copy finite position', async t => {
	const { runtime, bots } = await fixture(t)
	runtime.start()
	const bot = bots[0]!
	const initial = runtime.telemetry.getSnapshot()
	assert.equal(initial.health.value, null)
	assert.equal(initial.maxHealth.value, null)
	assert.equal(initial.food.value, null)
	assert.equal(initial.position.value, null)
	bot.health = 0
	bot.food = 0
	bot.emit('health')
	assert.deepEqual(runtime.telemetry.getSnapshot().health, {
		value: 0,
		updatedAt: 1000,
		stale: false
	})
	assert.deepEqual(runtime.telemetry.getSnapshot().food, {
		value: 0,
		updatedAt: 1000,
		stale: false
	})
	t.mock.timers.tick(50)
	bot.entity.position.set(12.5, 70, -4)
	bot.emit('move', bot.entity.position)
	const measured = runtime.telemetry.getSnapshot()
	assert.deepEqual(measured.position, {
		value: { x: 12.5, y: 70, z: -4 },
		updatedAt: 1050,
		stale: false
	})
	bot.entity.position.x = 999
	assert.equal(measured.position.value?.x, 12.5)
	assert.ok(Object.isFrozen(measured.position.value))
	bot.health = Number.NaN
	bot.food = Infinity
	bot.entity.position.x = Infinity
	bot.emit('health')
	bot.emit('move')
	assert.equal(runtime.telemetry.getSnapshot(), measured)
	assert.deepEqual(JSON.parse(JSON.stringify(measured)), measured)
})

test('maxHealth follows own measured attributes and modifiers across every installed supported protocol', async t => {
	for (const version of require('mineflayer').testedVersions as string[]) {
		await t.test(version, async t => {
			const { runtime, bots } = await fixture(t, { version })
			runtime.start()
			const bot = bots[0]!
			const types = bot.registry.protocol.play.toClient.types
			const event = types.packet_update_attributes
				? 'update_attributes'
				: 'entity_update_attributes'
			const fields = (types.packet_update_attributes ??
				types.packet_entity_update_attributes)[1]
			const identity = fields
				.find((field: { name: string }) => field.name === 'properties')
				.type[1].type[1].find(
					(field: { name: string }) =>
						field.name === 'name' || field.name === 'key'
				)
			const key =
				typeof identity.type === 'string'
					? bot.registry.attributesByName.maxHealth.resource
					: Object.values(identity.type[1].mappings).find(
							value => value === 'generic.max_health'
						)
			const property = {
				[identity.name]: key,
				value: 30,
				modifiers: [
					{ operation: 0, amount: 5 },
					{ operation: 1, amount: 0.2 },
					{ operation: 2, amount: 0.5 }
				]
			}
			bot._client.emit(event, { entityId: 42, properties: [property] })
			assert.equal(runtime.telemetry.getSnapshot().maxHealth.value, null)
			bot._client.emit(event, {
				entityId: bot.entity.id,
				properties: [{ ...property, modifiers: [{ operation: 9, amount: 1 }] }]
			})
			assert.equal(runtime.telemetry.getSnapshot().maxHealth.value, null)
			bot._client.emit(event, {
				entityId: bot.entity.id,
				properties: [property]
			})
			assert.deepEqual(runtime.telemetry.getSnapshot().maxHealth, {
				value: 63,
				updatedAt: 1000,
				stale: false
			})
			const measured = runtime.telemetry.getSnapshot()
			for (const invalid of [
				{ ...property, value: NaN },
				{ ...property, value: Infinity },
				{ ...property, modifiers: null },
				{ ...property, modifiers: [{ operation: 2, amount: Infinity }] },
				{ ...property, modifiers: [{ operation: 2, amount: -1 }] },
				{ ...property, [identity.name]: 'unrelated.attribute' }
			])
				bot._client.emit(event, {
					entityId: bot.entity.id,
					properties: [invalid]
				})
			assert.equal(runtime.telemetry.getSnapshot(), measured)
		})
	}
})

async function ready(
	runtime: ReturnType<typeof createBotRuntime>,
	bot: ReturnType<typeof createRuntimeConnectionBot>
) {
	bot.emit('botReady')
	assert.equal(await bot.hsm.ready, true)
	await flush()
	assert.equal(runtime.telemetry.getSnapshot().connection.state, 'ready')
}

test('one real HSM supplies compact cached facts, main entry time and independently changing monitoring', async t => {
	const { runtime, bots } = await fixture(t)
	runtime.start()
	const bot = bots[0]!
	await ready(runtime, bot)
	const first = runtime.telemetry.getSnapshot().harness
	assert.equal(first.value?.mainActivity, 'IDLE')
	assert.equal(first.value.enteredAt, 1000)
	assert.deepEqual(first.value.goal, { status: 'none', text: null })
	assert.equal(first.value.action, null)
	assert.deepEqual(first.value.monitoring, [
		'ENTITIES_MONITOR.RUNNING',
		'HEALTH_MONITOR',
		'HUNGER_MONITOR'
	])
	assert.ok(
		Object.isFrozen(first.value) &&
			Object.isFrozen(first.value.monitoring) &&
			Object.isFrozen(first.value.goal)
	)
	t.mock.timers.tick(25)
	bot.entity.position.x = Infinity
	bot.hsm.send({
		type: 'THREAT_OBSERVATION_INVALID',
		reason: 'invalid_bot_position'
	})
	const waiting = runtime.telemetry.getSnapshot().harness.value!
	assert.equal(waiting.mainActivity, 'OBSERVATION_WAIT')
	assert.equal(waiting.enteredAt, 1025)
	t.mock.timers.tick(25)
	// Exercise the real monitoring branch through its event boundary, not a fabricated snapshot.
	bot.hsm.send({
		type: 'THREAT_OBSERVATION_FAILED',
		error: 'fixture observer failure'
	})
	const retrying = runtime.telemetry.getSnapshot().harness.value!
	assert.ok(retrying.monitoring.includes('ENTITIES_MONITOR.RETRYING'))
	assert.equal(retrying.mainActivity, waiting.mainActivity)
	assert.equal(retrying.enteredAt, waiting.enteredAt)
	t.mock.timers.tick(1000)
	assert.ok(
		runtime.telemetry
			.getSnapshot()
			.harness.value!.monitoring.includes('ENTITIES_MONITOR.RUNNING')
	)
	assert.equal(
		runtime.telemetry.getSnapshot().harness.value?.enteredAt,
		waiting.enteredAt
	)
	bot.entity.position.x = 0
	t.mock.timers.tick(100)
	let cached = runtime.telemetry.getSnapshot()
	runtime.telemetry.subscribe(snapshot => {
		assert.equal(snapshot, cached)
	})()
	bot.health = 3
	bot.emit('health')
	cached = runtime.telemetry.getSnapshot()
	assert.ok(cached.harness.value!.mainActivity.startsWith('URGENT_NEEDS'))
	assert.equal(cached.harness.value!.enteredAt, 2150)
	assert.notEqual(cached.harness.value!.enteredAt, first.value.enteredAt)
	assert.deepEqual(JSON.parse(JSON.stringify(cached)), cached)
	assert.deepEqual(Object.keys(cached.harness.value!).sort(), [
		'action',
		'enteredAt',
		'goal',
		'mainActivity',
		'monitoring'
	])
})

test('disconnect preserves stale measurements, a new session requires new events and retained old callbacks are fenced', async t => {
	const { runtime, bots } = await fixture(t)
	runtime.telemetry.subscribe(() => {
		throw new Error('observer failure')
	})
	runtime.telemetry.subscribe(async () => {
		throw new Error('async observer failure')
	})
	const revisions: number[] = []
	const dispose = runtime.telemetry.subscribe(snapshot => {
		revisions.push(snapshot.revision)
	})
	runtime.start()
	const old = bots[0]!
	await ready(runtime, old)
	old.health = 16
	old.food = 11
	old.emit('health')
	old.emit('move')
	old._client.emit('entity_update_attributes', {
		entityId: old.entity.id,
		properties: [{ name: 'generic.max_health', value: 30, modifiers: [] }]
	})
	const known = runtime.telemetry.getSnapshot()
	const healthListeners = old.listeners('health')
	const moveListeners = old.listeners('move')
	const attributeListeners = old._client.listeners('entity_update_attributes')
	old.emit('botDisconnected')
	const disconnected = runtime.telemetry.getSnapshot()
	assert.equal(disconnected.connection.state, 'reconnecting')
	for (const key of [
		'health',
		'maxHealth',
		'food',
		'position',
		'harness'
	] as const) {
		assert.deepEqual(disconnected[key], { ...known[key], stale: true })
		assert.ok(Object.isFrozen(disconnected[key]))
	}
	await old.hsm.finalize()
	await flush()
	t.mock.timers.tick(3000)
	assert.equal(bots.length, 2)
	const fresh = bots[1]!
	const connecting = runtime.telemetry.getSnapshot()
	assert.notEqual(connecting.connection.sessionId, known.connection.sessionId)
	for (const key of [
		'health',
		'maxHealth',
		'food',
		'position',
		'harness'
	] as const)
		assert.deepEqual(connecting[key], {
			value: null,
			updatedAt: null,
			stale: false
		})
	await ready(runtime, fresh)
	const newSession = runtime.telemetry.getSnapshot()
	assert.equal(newSession.harness.value?.enteredAt, 4000)
	assert.equal(newSession.health.value, null)
	assert.equal(newSession.maxHealth.value, null)
	old.health = 1
	old.food = 1
	old.entity.position.set(999, 999, 999)
	for (const listener of healthListeners) listener()
	for (const listener of moveListeners) listener(old.entity.position)
	for (const listener of attributeListeners)
		listener({
			entityId: fresh.entity.id,
			properties: [{ name: 'generic.max_health', value: 99, modifiers: [] }]
		})
	old.hsm.send({
		type: 'USER_COMMAND',
		text: 'old private goal',
		username: 'alice'
	})
	assert.equal(runtime.telemetry.getSnapshot(), newSession)
	assert.equal(old.listeners('health').length, 0)
	assert.equal(old._client.listeners('entity_update_attributes').length, 0)
	fresh.health = 0
	fresh.food = 0
	fresh.emit('health')
	assert.equal(runtime.telemetry.getSnapshot().health.value, 0)
	assert.equal(runtime.telemetry.getSnapshot().health.stale, false)
	assert.equal(runtime.telemetry.getSnapshot().maxHealth.value, null)
	assert.ok(
		revisions.length > 5 &&
			revisions.every((revision, i) => i === 0 || revision > revisions[i - 1]!)
	)
	dispose()
	const count = revisions.length
	await runtime.stop()
	assert.equal(revisions.length, count)
	assert.equal(runtime.telemetry.getSnapshot().health.stale, true)
})

test('real model transport and Minecraft events project action, active/combat goal, finished goal and transport pause safely', async t => {
	let mode: 'follow' | 'finish' | 'pause' = 'follow'
	let requests = 0
	t.mock.method(
		Responses.prototype,
		'create',
		async (body: { previous_response_id?: string }) => {
			requests++
			if (mode === 'pause')
				throw Object.assign(new Error('fixture private transport payload'), {
					code: 'AI_PILOT_UNAVAILABLE'
				})
			return {
				id: `fixture-${requests}`,
				output_text: '',
				output: [
					{
						type: 'function_call',
						call_id: `call-${requests}`,
						name:
							mode === 'follow'
								? body.previous_response_id
									? 'follow_entity'
									: 'inspect_entities'
								: 'finish_goal',
						arguments: JSON.stringify(
							mode === 'follow'
								? body.previous_response_id
									? { entity_name: 'cow' }
									: {}
								: { message: 'Done' }
						)
					}
				]
			}
		}
	)
	const { runtime, bots } = await fixture(t, { ai: true })
	runtime.start()
	const bot = bots[0]!
	await ready(runtime, bot)
	const controller = bot.hsm
	const target = createEntityFixture({
		id: 53,
		name: 'cow',
		type: 'mob',
		position: new Vec3(8, 64, 0),
		isValid: true
	})
	bot.entities[target.id] = target
	bot.emit('chat', 'alice', ':Travel fixture-secret-token')
	await flush()
	const executing = runtime.telemetry.getSnapshot().harness.value!
	assert.equal(executing.mainActivity, 'TASKS.EXECUTING.FOLLOWING')
	assert.equal(executing.action, 'follow_entity')
	assert.deepEqual(executing.goal, {
		status: 'active',
		text: 'Travel <REDACTED>'
	})
	assert.equal(bot.hsm, controller)
	const sword = new ItemFactory(bot.registry.itemsByName.iron_sword.id, 1)
	bot.inventory.slots[36] = sword
	bot.inventory.items = () => [sword]
	const enemy = createEntityFixture({
		id: 54,
		name: 'zombie',
		type: 'mob',
		position: new Vec3(2, 64, 0),
		isValid: true
	})
	bot.entities[enemy.id] = enemy
	t.mock.timers.tick(100)
	await flush()
	const combat = runtime.telemetry.getSnapshot().harness.value!
	assert.equal(combat.mainActivity, 'COMBAT.MELEE_ATTACKING')
	assert.equal(combat.action, 'melee_attack')
	assert.deepEqual(combat.goal, executing.goal)
	assert.equal(
		controller.getContext().pendingExecution?.toolName,
		'follow_entity'
	)
	bot.emit('entityDead', enemy)
	delete bot.entities[enemy.id]
	await flush()
	assert.equal(
		runtime.telemetry.getSnapshot().harness.value?.action,
		'follow_entity'
	)
	mode = 'finish'
	delete bot.entities[target.id]
	t.mock.timers.tick(500)
	await flush()
	const finished = runtime.telemetry.getSnapshot().harness.value!
	assert.equal(finished.mainActivity, 'IDLE')
	assert.equal(finished.action, null)
	assert.deepEqual(finished.goal, { status: 'none', text: null })
	assert.equal(controller.getContext().lastAction, 'follow_entity')
	mode = 'pause'
	bot.emit('chat', 'alice', ':New goal fixture-secret-token')
	await flush()
	const paused = runtime.telemetry.getSnapshot().harness.value!
	assert.equal(paused.mainActivity, 'IDLE')
	assert.equal(paused.action, null)
	assert.deepEqual(paused.goal, {
		status: 'paused',
		text: 'New goal <REDACTED>'
	})
	assert.equal(
		JSON.stringify(runtime.telemetry.getSnapshot()).includes(
			'fixture-secret-token'
		),
		false
	)
	assert.equal(
		JSON.stringify(runtime.telemetry.getSnapshot()).includes(
			'fixture private transport payload'
		),
		false
	)
	bot.emit('botDisconnected')
	assert.equal(runtime.telemetry.getSnapshot().harness.stale, true)
	assert.deepEqual(
		runtime.telemetry.getSnapshot().harness.value?.goal,
		paused.goal
	)
	await controller.finalize()
	await flush()
	t.mock.timers.tick(3000)
	const reconnected = bots[1]!
	assert.equal(runtime.telemetry.getSnapshot().harness.value, null)
	await ready(runtime, reconnected)
	assert.deepEqual(
		runtime.telemetry.getSnapshot().harness.value?.goal,
		paused.goal
	)
	assert.equal(runtime.telemetry.getSnapshot().harness.stale, false)
	assert.notEqual(reconnected.hsm, controller)
	reconnected.emit('chat', 'alice', ':stop')
	assert.deepEqual(runtime.telemetry.getSnapshot().harness.value?.goal, {
		status: 'none',
		text: null
	})
	assert.equal(bot.hsm, controller)
})

test('native entity name-field cache loss cannot replace the measured maxHealth source', async t => {
	const { runtime, bots } = await fixture(t, { entitiesPlugin: true })
	runtime.start()
	const bot = bots[0]!
	Object.assign(bot.entities, { [bot.entity.id]: bot.entity })
	bot._client.emit('entity_update_attributes', {
		entityId: bot.entity.id,
		properties: [{ name: 'generic.max_health', value: 36, modifiers: [] }]
	})
	const attributes: unknown = Reflect.get(bot.entity, 'attributes')
	assert.deepEqual(attributes, { undefined: { value: 36, modifiers: [] } })
	assert.equal(runtime.telemetry.getSnapshot().maxHealth.value, 36)
})

test('registry arriving after native construction still establishes measured maxHealth without a ready default', async t => {
	const { runtime, bots } = await fixture(t, { deferredRegistry: true })
	runtime.start()
	const bot = bots[0]!
	assert.equal(runtime.telemetry.getSnapshot().maxHealth.value, null)
	bot.registry = minecraftData('1.20.4')
	bot.emit('inject_allowed')
	bot._client.emit('entity_update_attributes', {
		entityId: bot.entity.id,
		properties: [{ name: 'generic.max_health', value: 40, modifiers: [] }]
	})
	assert.equal(runtime.telemetry.getSnapshot().maxHealth.value, 40)
})

test('goal summaries redact captured credential and endpoint forms before a finite text cap', async t => {
	t.mock.method(Responses.prototype, 'create', async () => {
		throw Object.assign(new Error('fixture transport'), {
			code: 'AI_PILOT_UNAVAILABLE'
		})
	})
	const { runtime, bots } = await fixture(t, {
		ai: true,
		endpoint:
			'https://fixture-user:fixture-pass@fixture.invalid/v1?token=fixture-query#fixture-fragment'
	})
	runtime.start()
	const bot = bots[0]!
	await ready(runtime, bot)
	bot.emit(
		'chat',
		'alice',
		`:Travel fixture-secret-token fixture-user fixture-pass fixture-query fixture-fragment https://fixture-user:fixture-pass@fixture.invalid/v1/responses?token=fixture-query#fixture-fragment ${'x'.repeat(1000)}`
	)
	await flush()
	const snapshot = runtime.telemetry.getSnapshot()
	assert.equal(snapshot.harness.value?.goal.status, 'paused')
	assert.equal(snapshot.harness.value?.goal.text?.length, 512)
	for (const secret of [
		'fixture-secret-token',
		'fixture-user',
		'fixture-pass',
		'fixture-query',
		'fixture-fragment'
	])
		assert.equal(JSON.stringify(snapshot).includes(secret), false)
	assert.ok(
		snapshot.harness.value!.goal.text!.includes(
			'https://fixture.invalid/v1/responses'
		)
	)
	assert.deepEqual(JSON.parse(JSON.stringify(snapshot)), snapshot)
})

test('telemetry cancellation during the first HSM fact cannot resume initialization or refresh stopped facts', async t => {
	const { runtime, bots } = await fixture(t)
	const stopping: { promise?: ReturnType<typeof runtime.stop> } = {}
	runtime.telemetry.subscribe(snapshot => {
		if (snapshot.harness.value && !stopping.promise)
			stopping.promise = runtime.stop()
	})
	runtime.start()
	const bot = bots[0]!
	bot.emit('botReady')
	assert.equal(await bot.hsm.ready, false)
	assert.ok(stopping.promise)
	assert.equal((await stopping.promise).outcome, 'stopped')
	const final = runtime.telemetry.getSnapshot()
	assert.equal(final.connection.state, 'stopped')
	assert.equal(final.harness.stale, true)
	assert.equal(bot.chatMessages.includes('Я готов к работе ;)'), false)
	bot.emit('health')
	bot.emit('move')
	bot.hsm.send({ type: 'USER_COMMAND', text: 'late goal', username: 'alice' })
	assert.equal(runtime.telemetry.getSnapshot(), final)
})
