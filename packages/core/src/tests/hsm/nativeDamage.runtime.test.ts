import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import test from 'node:test'

import { Vec3 } from 'vec3'

import {
	type NativeDamageObservation,
	observeNativeDamage,
	startNativeDamageSession
} from '@/modules/connection/nativeDamage.js'

import {
	HandoffBot,
	createEntityFixture,
	createHarness
} from './fixtures/handoffBot.js'

const require = createRequire(import.meta.url)

const codec = (id: number, name = 'minecraft:arrow') => ({
	type: 'compound',
	value: {
		'minecraft:damage_type': {
			type: 'compound',
			value: {
				value: {
					type: 'list',
					value: {
						type: 'compound',
						value: [
							{
								id: { type: 'int', value: id },
								name: { type: 'string', value: name }
							}
						]
					}
				}
			}
		}
	}
})

const packet = (bot: HandoffBot, fields: Record<string, unknown> = {}) => ({
	entityId: bot.entity.id,
	sourceTypeId: 71,
	sourceCauseId: 2,
	sourceDirectId: 8,
	sourcePosition: null,
	...fields
})

function nativeEntities(bot: HandoffBot) {
	require('mineflayer/lib/plugins/entities')(bot)
	Object.assign(bot.entities, { [bot.entity.id]: bot.entity })
}

for (const nativeFirst of [true, false]) {
	test(`raw damage preserves unloaded cause and counts a native hit once (${nativeFirst ? 'native' : 'observer'} first)`, t => {
		const { bot, actor } = createHarness()
		t.after(() => actor.stop())
		// The HSM already owns its observation; inject native entities on either side of an extra reader.
		if (nativeFirst) nativeEntities(bot)
		const damages: NativeDamageObservation[] = []
		const stop = observeNativeDamage(bot.asBot(), damage =>
			damages.push(damage)
		)
		t.after(stop)
		if (!nativeFirst) nativeEntities(bot)
		bot.entities[7] = createEntityFixture({
			id: 7,
			name: 'arrow',
			position: new Vec3(0, 64, 0),
			isValid: true
		})
		const sourcePosition = { x: 24, y: 64, z: 3 }
		bot._client.emit(
			'damage_event',
			packet(bot, { sourceCauseId: 31, sourcePosition })
		)
		assert.equal(actor.getSnapshot().context.lastDamage.sequence, 1)
		assert.equal(actor.getSnapshot().context.lastDamage.sourceId, 30)
		assert.equal(damages.length, 1)
		assert.equal(damages[0]?.ranged, true)
		assert.deepEqual(damages[0]?.sourcePosition, new Vec3(24, 64, 3))
		sourcePosition.x = 999
		assert.equal(actor.getSnapshot().context.lastDamage.sourcePosition?.x, 24)
		assert.equal(damages[0]?.sourcePosition?.x, 24)
	})
}

for (const version of ['1.19.4', '1.20.1', '1.20.4', '1.20.6', '1.21.4']) {
	test(`${version}: packet source ids use plus-one with zero reserved for absence`, t => {
		const bot = new HandoffBot(version)
		nativeEntities(bot)
		const damages: NativeDamageObservation[] = []
		const stop = observeNativeDamage(bot.asBot(), damage =>
			damages.push(damage)
		)
		t.after(stop)
		bot.entities[0] = createEntityFixture({
			id: 0,
			name: 'skeleton',
			position: new Vec3(20, 64, 0),
			isValid: true
		})
		bot._client.emit(
			'damage_event',
			packet(bot, { sourceCauseId: 1, sourceDirectId: 1 })
		)
		assert.equal(damages[0]?.sourceId, 0)
		assert.equal(
			damages[0]?.ranged,
			false,
			'shooter species does not prove projectile damage'
		)
		assert.deepEqual(damages[0]?.sourcePosition, new Vec3(20, 64, 0))
		bot._client.emit(
			'damage_event',
			packet(bot, { sourceCauseId: 0, sourceDirectId: 0 })
		)
		assert.equal(damages[1]?.sourceId, null)
		assert.equal(damages[1]?.sourcePosition, null)
		assert.equal(damages.length, 2)
	})
}

for (const representation of ['login', 'codec', 'entries']) {
	test(`early ${representation} damage registry proves an unloaded projectile without assuming static ordinals`, t => {
		const bot = new HandoffBot(
			representation === 'entries' ? '1.20.6' : '1.20.4'
		)
		const disposeSession = startNativeDamageSession(bot.asBot())
		t.after(disposeSession)
		if (representation === 'login')
			bot._client.emit('login', { dimensionCodec: codec(71) })
		if (representation === 'codec')
			bot._client.emit('registry_data', { codec: codec(71) })
		if (representation === 'entries')
			bot._client.emit('registry_data', {
				id: 'minecraft:damage_type',
				entries: [
					{ key: 'minecraft:mob_attack', value: null },
					{ key: 'minecraft:arrow', value: null }
				]
			})
		const damages: NativeDamageObservation[] = []
		const stop = observeNativeDamage(bot.asBot(), damage =>
			damages.push(damage)
		)
		t.after(stop)
		bot._client.emit(
			'damage_event',
			packet(bot, { sourceTypeId: representation === 'entries' ? 1 : 71 })
		)
		assert.equal(damages[0]?.ranged, true)
		assert.equal(damages[0]?.sourceId, 1)
		bot._client.emit('damage_event', packet(bot, { sourceTypeId: 99 }))
		assert.equal(damages[1]?.ranged, false)
	})
}

test('registry replacement invalidates prior ranged mappings rather than retaining a stale ordinal', t => {
	const bot = new HandoffBot('1.20.6')
	const damages: NativeDamageObservation[] = []
	const stop = observeNativeDamage(bot.asBot(), damage => damages.push(damage))
	t.after(stop)
	bot._client.emit('registry_data', {
		id: 'minecraft:damage_type',
		entries: [{ key: 'minecraft:arrow' }]
	})
	bot._client.emit('damage_event', packet(bot, { sourceTypeId: 0 }))
	assert.equal(damages[0]?.ranged, true)
	bot._client.emit('registry_data', {
		id: 'minecraft:damage_type',
		entries: [{ key: 'minecraft:mob_attack' }]
	})
	bot._client.emit('damage_event', packet(bot, { sourceTypeId: 0 }))
	assert.equal(damages[1]?.ranged, false)
	bot._client.emit('registry_data', {
		id: 'minecraft:damage_type',
		entries: [{ key: 'minecraft:arrow' }, { key: 7 }]
	})
	bot._client.emit('damage_event', packet(bot, { sourceTypeId: 0 }))
	assert.equal(
		damages[2]?.ranged,
		false,
		'partially malformed registries grant no evidence'
	)
})

test('irrelevant victims and malformed modern packets cannot fall back to native source guesses', t => {
	const { bot, actor } = createHarness()
	t.after(() => actor.stop())
	nativeEntities(bot)
	for (const fields of [
		{ entityId: 42 },
		{ sourceCauseId: -1 },
		{ sourceCauseId: 0.5 },
		{ sourceDirectId: Number.NaN },
		{ sourceTypeId: '71' },
		{ sourceCauseId: 0x80000000 },
		{ sourcePosition: { x: Infinity, y: 64, z: 0 } }
	])
		bot._client.emit('damage_event', packet(bot, fields))
	assert.equal(actor.getSnapshot().context.lastDamage.sequence, 0)
	assert.deepEqual(actor.getSnapshot().context.aggressionByEntity, {})
	bot._client.emit('damage_event', packet(bot))
	assert.equal(actor.getSnapshot().context.lastDamage.sequence, 1)
	assert.equal(actor.getSnapshot().context.lastDamage.sourceId, 1)
})

test('legacy entity status still reports damage without inventing a source', t => {
	const { bot, actor } = createHarness(false, '1.18.2')
	t.after(() => actor.stop())
	nativeEntities(bot)
	bot._client.emit('entity_status', {
		entityId: bot.entity.id,
		entityStatus: 2
	})
	assert.equal(actor.getSnapshot().context.lastDamage.sequence, 1)
	assert.equal(actor.getSnapshot().context.lastDamage.sourceId, null)
	bot._client.emit('entity_status', { entityId: 7, entityStatus: 2 })
	assert.equal(actor.getSnapshot().context.lastDamage.sequence, 1)
})

test('an unsupported packet schema does not attribute a modern source, but retains legacy fallback', t => {
	const bot = new HandoffBot('1.18.2')
	nativeEntities(bot)
	bot.entities[1] = createEntityFixture({
		id: 1,
		name: 'skeleton',
		position: new Vec3(20, 64, 0)
	})
	const damages: NativeDamageObservation[] = []
	const stop = observeNativeDamage(bot.asBot(), damage => damages.push(damage))
	t.after(stop)
	bot._client.emit('damage_event', packet(bot))
	assert.equal(damages.length, 0)
	bot.emit('entityHurt', bot.entity)
	assert.equal(damages.length, 1)
	assert.equal(damages[0]?.sourceId, null)
})

test('observer and session cleanup fence queued callbacks, release listeners and discard previous registries', () => {
	const bot = new HandoffBot()
	const disposeSession = startNativeDamageSession(bot.asBot())
	bot._client.emit('registry_data', { codec: codec(71) })
	const damages: NativeDamageObservation[] = []
	const stop = observeNativeDamage(bot.asBot(), damage => damages.push(damage))
	const raw = bot._client.listeners('damage_event')
	const registry = bot._client.listeners('registry_data')
	const hurt = bot.listeners('entityHurt')
	stop()
	disposeSession()
	for (const callback of raw) callback(packet(bot))
	for (const callback of registry) callback({ codec: codec(71) })
	for (const callback of hurt) callback(bot.entity)
	assert.equal(damages.length, 0)
	assert.equal(bot._client.listenerCount('damage_event'), 0)
	assert.equal(bot._client.listenerCount('registry_data'), 0)
	assert.equal(bot._client.listenerCount('login'), 0)
	assert.equal(bot.listenerCount('entityHurt'), 0)
	const restart = observeNativeDamage(bot.asBot(), damage =>
		damages.push(damage)
	)
	bot._client.emit('damage_event', packet(bot))
	assert.equal(damages[0]?.ranged, false)
	restart()
})
