import assert from 'node:assert/strict'
import test from 'node:test'

import { readCreeperSignals, readMobMetadata } from '@/utils/combat/mobSignals'

import {
	HandoffBot,
	createEntityFixture,
	registry
} from './fixtures/handoffBot'

test('creeper decoder uses named keys and keeps swelling, charge and ignition distinct', () => {
	const bot = new HandoffBot()
	bot.registry = {
		...registry,
		entitiesByName: {
			...registry.entitiesByName,
			creeper: { metadataKeys: ['is_ignited', 'is_powered', 'swell_dir'] }
		}
	}
	const entity = createEntityFixture({ name: 'creeper' })
	Object.assign(entity.metadata, { 0: false, 1: true, 2: -1 })
	assert.deepEqual(readCreeperSignals(bot.asBot(), entity), {
		swelling: false,
		powered: true,
		ignited: false
	})
	Object.assign(entity.metadata, { 0: true, 1: false, 2: 1 })
	assert.deepEqual(readCreeperSignals(bot.asBot(), entity), {
		swelling: true,
		powered: false,
		ignited: true
	})
})

test('malformed or missing metadata and absent schemas remain unknown, never proof of safety', () => {
	const bot = new HandoffBot()
	const entity = createEntityFixture({ name: 'creeper' })
	const unknown = { swelling: null, powered: null, ignited: null }
	assert.deepEqual(readCreeperSignals(bot.asBot(), entity), unknown)
	for (const key of registry.entitiesByName.creeper.metadataKeys)
		Object.assign(entity.metadata, {
			[registry.entitiesByName.creeper.metadataKeys.indexOf(key)]: 'false'
		})
	assert.deepEqual(readCreeperSignals(bot.asBot(), entity), unknown)
	bot.registry = {
		...registry,
		entitiesByName: { ...registry.entitiesByName, creeper: {} }
	}
	Object.assign(entity.metadata, { 16: -1, 17: false, 18: false })
	assert.deepEqual(readCreeperSignals(bot.asBot(), entity), unknown)
	assert.equal(readMobMetadata(bot.asBot(), entity, 'swell_dir'), undefined)
})

for (const version of ['1.20.1', '1.20.4', '1.20.6']) {
	test(`${version}: named metadata decodes creeper, slime and enderman signals`, () => {
		const bot = new HandoffBot(version)
		const creeper = createEntityFixture({ name: 'creeper' })
		for (const [key, value] of Object.entries({
			swell_dir: -1,
			is_powered: false,
			is_ignited: false
		}))
			Object.assign(creeper.metadata, {
				[bot.registry.entitiesByName.creeper.metadataKeys.indexOf(key)]: value
			})
		assert.deepEqual(readCreeperSignals(bot.asBot(), creeper), {
			swelling: false,
			powered: false,
			ignited: false
		})
		const slime = createEntityFixture({ name: 'slime' })
		Object.assign(slime.metadata, {
			[bot.registry.entitiesByName.slime.metadataKeys.indexOf('size')]: 1
		})
		assert.equal(readMobMetadata(bot.asBot(), slime, 'size'), 1)
		const enderman = createEntityFixture({ name: 'enderman' })
		Object.assign(enderman.metadata, {
			[bot.registry.entitiesByName.enderman.metadataKeys.indexOf('creepy')]:
				false
		})
		assert.equal(readMobMetadata(bot.asBot(), enderman, 'creepy'), false)
	})
}
