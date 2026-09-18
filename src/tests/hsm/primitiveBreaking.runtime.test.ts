import assert from 'node:assert/strict'
import test from 'node:test'
import { setImmediate as flush } from 'node:timers/promises'

import type { Item } from '@/types/index.js'
import { Vec3 } from 'vec3'
import { createActor, setup } from 'xstate'

import { primitiveBreaking } from '@/hsm/actors/primitives/primitiveBreaking.primitive.js'
import { resolveMiningResource } from '@/hsm/tasks/miningResource.js'
import type { MachineEvent } from '@/hsm/types.js'

import { ItemFactory, createHarness } from './fixtures/handoffBot.js'

const keyOf = (position: Vec3): string => {
	const floored = position.floored()
	return `${floored.x}:${floored.y}:${floored.z}`
}

test('breaking pickup requires real travel to the drop', async t => {
	t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] })
	const { bot, actor, enemy, step } = createHarness()
	// Keep the harness machine out of combat: the fight is about walking.
	enemy.position = new Vec3(30, 64, 0)

	try {
		// A solid stone target two blocks away; digging opens the cell.
		const target = new Vec3(2, 64, 0)
		const dug = new Set<string>()
		bot.solidAt = (position: Vec3) => {
			if (position.y < 64) {
				return true
			}
			const floored = position.floored()
			return (
				floored.x === 2 &&
				floored.y === 64 &&
				floored.z === 0 &&
				!dug.has(keyOf(floored))
			)
		}
		const realDig = bot.dig.bind(bot)
		bot.dig = async (block: { position: Vec3 }) => {
			dug.add(keyOf(block.position))
			await realDig(block)
		}
		bot.tool = { equipForBlock: async () => {} }

		const block = bot.blockAt(target)
		const expectedDrop = block.drops[0]
		const dropId =
			typeof expectedDrop === 'number'
				? expectedDrop
				: typeof expectedDrop.drop === 'number'
					? expectedDrop.drop
					: expectedDrop.drop.id

		// The world yields the drop only within pickup reach of the bot.
		const held: Item[] = [
			new ItemFactory(bot.registry.itemsByName.iron_pickaxe.id, 1)
		]
		bot.inventory.items = () => held
		let distanceAtPickup = Number.POSITIVE_INFINITY

		const events: string[] = []
		const parent = createActor(
			setup({
				types: { events: {} as MachineEvent },
				actors: { service: primitiveBreaking }
			}).createMachine({
				invoke: {
					src: 'service',
					input: {
						bot: bot.asBot(),
						options: {
							block,
							miningResource: resolveMiningResource(
								bot.asBot(),
								block.name,
								bot.registry.items[dropId].name
							)
						}
					}
				},
				on: {
					'*': {
						actions: ({ event }) => {
							events.push(event.type)
						}
					}
				}
			})
		)
		parent.start()
		try {
			const startDistance = bot.entity.position.distanceTo(target)
			assert.ok(startDistance > 1.5, 'drop must start out of pickup reach')

			let done = false
			for (let i = 0; i < 240 && !done; i++) {
				t.mock.timers.tick(50)
				await flush()
				step()
				if (
					!held.some(item => item.type === dropId) &&
					bot.entity.position.distanceTo(target) <= 0.6
				) {
					distanceAtPickup = bot.entity.position.distanceTo(target)
					held.push(new ItemFactory(dropId, 1))
				}
				done = events.some(
					event => event === 'BROKEN' || event === 'BREAKING_FAILED'
				)
			}

			assert.deepEqual(events, ['BROKEN'])
			assert.equal(bot.digCalls.length, 1)
			// The bot really walked: pickup happened at the drop, far from start.
			assert.ok(distanceAtPickup <= 0.6, `pickup at ${distanceAtPickup}`)
			assert.ok(
				bot.entity.position.x > 0.5,
				`bot never travelled, x=${bot.entity.position.x}`
			)
		} finally {
			parent.stop()
		}
	} finally {
		actor.stop()
	}
})
