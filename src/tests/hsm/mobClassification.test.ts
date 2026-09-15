import assert from 'node:assert/strict'
import test from 'node:test'

import { Vec3 } from 'vec3'

import { context as initialContext } from '@/hsm/context'

import { assessMob } from '@/utils/combat/selfDefense'

import { HandoffBot, createEntityFixture } from './fixtures/handoffBot'

for (const version of ['1.20.1', '1.20.4', '1.20.6']) {
	test(`${version}: registry categories classify ordinary mobs independently of representation type`, () => {
		const bot = new HandoffBot(version)
		const context = { ...initialContext, bot: bot.asBot() }
		for (const name of [
			'llama',
			'trader_llama',
			'wandering_trader',
			'cow',
			'dolphin',
			'fox',
			'allay'
		]) {
			const entity = createEntityFixture({
				name,
				type: bot.registry.entitiesByName[name].type,
				position: new Vec3(2, 64, 0)
			})
			assert.equal(assessMob(context, entity), null, name)
		}
		for (const name of [
			'zombie',
			'skeleton',
			'drowned',
			'hoglin',
			'magma_cube',
			'ghast',
			'phantom',
			'shulker'
		]) {
			const entity = createEntityFixture({
				name,
				type: bot.registry.entitiesByName[name].type,
				position: new Vec3(2, 64, 0)
			})
			assert.equal(assessMob(context, entity), 'hostile', name)
		}
	})

	test(`${version}: category exceptions preserve conditional aggression and avoid-only bosses`, () => {
		const bot = new HandoffBot(version)
		const context = { ...initialContext, bot: bot.asBot() }
		for (const name of [
			'piglin',
			'zombified_piglin',
			'polar_bear',
			'iron_golem',
			'goat',
			'pufferfish'
		]) {
			const entity = createEntityFixture({
				name,
				type: bot.registry.entitiesByName[name].type,
				position: new Vec3(2, 64, 0)
			})
			assert.equal(assessMob(context, entity), 'uncertain', name)
		}
		for (const name of ['skeleton_horse', 'zombie_horse']) {
			const entity = createEntityFixture({
				name,
				type: bot.registry.entitiesByName[name].type,
				position: new Vec3(2, 64, 0)
			})
			assert.equal(assessMob(context, entity), null, name)
		}
		for (const name of ['wither', 'ender_dragon', 'warden']) {
			const entity = createEntityFixture({
				name,
				type: bot.registry.entitiesByName[name].type,
				position: new Vec3(2, 64, 0)
			})
			assert.equal(
				assessMob(
					{ ...context, aggressionByEntity: { [entity.id]: Date.now() } },
					entity
				),
				'avoid',
				name
			)
		}
	})

	test(`${version}: rabbit variant overrides the passive category without hiding unknown signals`, () => {
		const bot = new HandoffBot(version)
		const context = { ...initialContext, bot: bot.asBot() }
		const entity = createEntityFixture({
			name: 'rabbit',
			type: bot.registry.entitiesByName.rabbit.type,
			position: new Vec3(2, 64, 0)
		})
		const index =
			bot.registry.entitiesByName.rabbit.metadataKeys.indexOf('type')
		for (const variant of [0, 1, 2, 3, 4, 5]) {
			Object.assign(entity.metadata, { [index]: variant })
			assert.equal(assessMob(context, entity), null)
		}
		Object.assign(entity.metadata, { [index]: 99 })
		assert.equal(assessMob(context, entity), 'hostile')
		for (const variant of [undefined, '0', -1, 6, NaN]) {
			Object.assign(entity.metadata, { [index]: variant })
			assert.equal(assessMob(context, entity), 'uncertain')
		}
	})
}

test('unknown registry categories do not fall back to a manual whitelist or entity.type', () => {
	const bot = new HandoffBot('1.20.6')
	const entity = createEntityFixture({
		name: 'cow',
		type: bot.registry.entitiesByName.cow.type,
		position: new Vec3(2, 64, 0)
	})
	for (const category of [undefined, 'UNKNOWN', 'Future category']) {
		bot.registry = {
			...bot.registry,
			entitiesByName: {
				...bot.registry.entitiesByName,
				cow: { ...bot.registry.entitiesByName.cow, category }
			}
		}
		assert.equal(
			assessMob({ ...initialContext, bot: bot.asBot() }, entity),
			'uncertain'
		)
	}
	entity.name = 'not_in_registry'
	entity.type = 'hostile'
	assert.equal(
		assessMob({ ...initialContext, bot: bot.asBot() }, entity),
		'uncertain'
	)
})
