import assert from 'node:assert/strict'
import test from 'node:test'
import { setImmediate as flush } from 'node:timers/promises'

import { createHarness } from './fixtures/handoffBot.js'

for (const version of ['1.20.1', '1.20.4', '1.20.6']) {
	test(`${version}: armed bot attacks a close zombie and physically escapes at critical health`, async t => {
		t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] })
		const { bot, actor, enemy, step } = createHarness(true, version)
		t.after(() => actor.stop())
		bot.entities = { 1: enemy }
		await flush()
		for (let i = 0; i < 20; i++) {
			t.mock.timers.tick(50)
			await flush()
			step()
		}
		assert.ok(
			bot.attacks.includes(enemy.id),
			'must attack, not reject the connection version'
		)
		actor.send({ type: 'UPDATE_HEALTH', health: 8 })
		const attacks = bot.attacks.length
		const startX = bot.entity.position.x
		for (let i = 0; i < 30; i++) {
			t.mock.timers.tick(50)
			await flush()
			step()
		}
		assert.equal(bot.attacks.length, attacks)
		assert.ok(bot.entity.position.x < startX - 2)
	})

	for (const scenario of [
		{
			name: 'sunlit day',
			day: true,
			block: 0,
			sky: 15,
			attacked: false,
			dangerous: false
		},
		{
			name: 'daytime cave',
			day: true,
			block: 0,
			sky: 0,
			attacked: false,
			dangerous: true
		},
		{
			name: 'night',
			day: false,
			block: 0,
			sky: 15,
			attacked: false,
			dangerous: true
		},
		{
			name: 'torchlight at night',
			day: false,
			block: 15,
			sky: 0,
			attacked: false,
			dangerous: false
		},
		{
			name: 'confirmed attack in sunlight',
			day: true,
			block: 0,
			sky: 15,
			attacked: true,
			dangerous: true
		}
	]) {
		test(`${version}: spider in ${scenario.name}`, async t => {
			t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] })
			const { bot, actor, enemy, step } = createHarness(true, version)
			t.after(() => actor.stop())
			enemy.name = 'spider'
			bot.time = { isDay: scenario.day, timeOfDay: scenario.day ? 1000 : 18000 }
			const blockAt = bot.blockAt.bind(bot)
			bot.blockAt = position => {
				const block = blockAt(position)
				block.light = scenario.block
				block.skyLight = scenario.sky
				return block
			}
			bot.entities = { 1: enemy }
			if (scenario.attacked) bot.emit('entityHurt', bot.entity, enemy)
			await flush()
			for (let i = 0; i < 20; i++) {
				t.mock.timers.tick(50)
				await flush()
				step()
			}
			assert.equal(bot.attacks.includes(enemy.id), scenario.dangerous)
			assert.equal(
				actor.getSnapshot().matches({ MAIN_ACTIVITY: 'IDLE' }),
				!scenario.dangerous
			)
			if (!scenario.dangerous) {
				assert.equal(actor.getSnapshot().context.nearestThreat, null)
				assert.equal(
					bot.entity.position.x,
					0,
					'must not flee a non-threatening spider'
				)
			}
		})
	}
}
