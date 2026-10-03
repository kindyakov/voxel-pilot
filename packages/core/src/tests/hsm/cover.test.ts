import assert from 'node:assert/strict'
import test from 'node:test'

import { Vec3 } from 'vec3'

import { isCoveredFrom } from '@/utils/combat/cover.js'

import { BlockFactory, HandoffBot } from './fixtures/handoffBot.js'

test('cover uses collision shapes: a lower slab does not block high fire while an upper slab does', () => {
	const bot = new HandoffBot()
	const original = bot.blockAt.bind(bot)
	for (const type of ['bottom', 'top']) {
		bot.blockAt = position => {
			const block = original(position)
			if (Math.floor(position.x) === 3 && Math.floor(position.y) === 65) {
				const slab = BlockFactory.fromProperties(
					'stone_slab',
					{ type, waterlogged: 'false' },
					0
				)
				slab.position = position.floored()
				return slab
			}
			return block
		}
		assert.equal(
			isCoveredFrom(
				bot.asBot(),
				new Vec3(0.5, 64, 0.5),
				new Vec3(8.5, 64, 0.5)
			),
			type === 'top'
		)
	}
})

test('thin fence shape outside the ray is not cover; crossing its post is cover', () => {
	const bot = new HandoffBot()
	const original = bot.blockAt.bind(bot)
	bot.blockAt = position => {
		const block = original(position)
		if (Math.floor(position.x) === 3 && Math.floor(position.y) === 65)
			Object.assign(block, {
				transparent: false,
				shapes: [[0.375, 0, 0.375, 0.625, 1.5, 0.625]]
			})
		return block
	}
	assert.equal(
		isCoveredFrom(bot.asBot(), new Vec3(0.5, 64, 0.1), new Vec3(8.5, 64, 0.1)),
		false
	)
	assert.equal(
		isCoveredFrom(bot.asBot(), new Vec3(0.5, 64, 0.5), new Vec3(8.5, 64, 0.5)),
		true
	)
})

test('unloaded cells beyond an apparent wall revoke the cover proof', () => {
	const bot = new HandoffBot()
	bot.solidAt = p => p.y < 64 || (Math.floor(p.x) === 3 && p.y < 68)
	const original = bot.blockAt.bind(bot)
	// Model the nullable native block boundary rather than manufacture a loaded cell.
	const nativeBot = bot.asBot()
	nativeBot.blockAt = position =>
		Math.floor(position.x) === 6 ? null : original(position)
	assert.equal(
		isCoveredFrom(nativeBot, new Vec3(0.5, 64, 0.5), new Vec3(8.5, 64, 0.5)),
		false
	)
})

test('the actual shooter height changes whether a low wall provides cover', () => {
	const bot = new HandoffBot()
	bot.solidAt = p => p.y < 64 || (Math.floor(p.x) === 6 && p.y < 66)
	const position = new Vec3(0.5, 64, 0.5)
	const source = new Vec3(8.5, 64, 0.5)
	assert.equal(isCoveredFrom(bot.asBot(), position, source, 1.8), true)
	assert.equal(isCoveredFrom(bot.asBot(), position, source, 4), false)
})
