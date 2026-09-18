import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'

import { Vec3 } from 'vec3'
import { createActor, setup } from 'xstate'

import { primitiveBreaking } from '../../hsm/actors/primitives/primitiveBreaking.primitive.js'
import { primitiveNavigating } from '../../hsm/actors/primitives/primitiveNavigating.primitive.js'
import { context } from '../../hsm/context.js'
import { createStatefulService } from '../../hsm/helpers/createStatefulService.js'

const runService = (service: any, bot: any, options: unknown = {}) => {
	const events: any[] = []
	bot.hsm = { getContext: () => ({ ...context, bot }) }
	const parent = createActor(
		setup({ actors: { service } }).createMachine({
			invoke: { src: 'service', input: { bot, options } },
			on: {
				'*': {
					actions: ({ event }) => {
						events.push(event)
					}
				}
			}
		})
	)
	parent.start()
	return { parent, events }
}

for (const status of ['noPath', 'timeout']) {
	test(`navigation reports ${status} from path_update`, () => {
		const bot = Object.assign(new EventEmitter(), {
			pathfinder: { setGoal() {} }
		})
		const { parent, events } = runService(primitiveNavigating, bot, {
			target: new Vec3(10, 64, 0)
		})
		try {
			bot.emit('path_update', { status })
			assert.equal(events[0]?.type, 'NAVIGATION_FAILED')
			assert.match(events[0]?.reason ?? '', new RegExp(status))
		} finally {
			parent.stop()
		}
	})
}

test('service reports synchronous startup errors instead of hanging', () => {
	const service = createStatefulService({
		name: 'startupFailure',
		onStart() {
			throw new Error('startup failed')
		}
	})
	const { parent, events } = runService(service, new EventEmitter())
	try {
		assert.deepEqual(events, [{ type: 'ERROR', error: 'startup failed' }])
	} finally {
		parent.stop()
	}
})

test('a navigation without pathfinder results reaches its deadline', t => {
	t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] })
	const bot = Object.assign(new EventEmitter(), {
		pathfinder: { setGoal() {} }
	})
	const { parent, events } = runService(primitiveNavigating, bot, {
		target: new Vec3(10, 64, 0)
	})
	try {
		t.mock.timers.tick(30_000)
		assert.deepEqual(events, [
			{ type: 'ERROR', error: 'PrimitiveNavigating timed out' }
		])
		t.mock.timers.tick(60_000)
		assert.equal(events.length, 1)
	} finally {
		parent.stop()
	}
})

test('a continuous service bounds a hanging startup operation', t => {
	t.mock.timers.enable({ apis: ['setTimeout'] })
	const service = createStatefulService({
		name: 'hangingEquip',
		operationTimeoutMs: 15_000,
		onStart: () => new Promise<void>(() => {})
	})
	const { parent, events } = runService(service, new EventEmitter())
	try {
		t.mock.timers.tick(15_000)
		assert.deepEqual(events, [
			{ type: 'ERROR', error: 'hangingEquip operation timed out' }
		])
	} finally {
		parent.stop()
	}
})

test('a stopped service removes listeners and ignores late rejected operations', async () => {
	let rejectOperation: (error: Error) => void = () => {}
	const bot = new EventEmitter()
	const service = createStatefulService({
		name: 'cancelOperation',
		onStart: () =>
			new Promise<void>((_resolve, reject) => {
				rejectOperation = reject
			}),
		onEvents: () => ({ physicsTick() {} })
	})
	const { parent, events } = runService(service, bot)
	assert.equal(bot.listenerCount('physicsTick'), 1)
	parent.stop()
	assert.equal(bot.listenerCount('physicsTick'), 0)
	rejectOperation(new Error('late error'))
	await delay(0)
	assert.deepEqual(events, [])
})

test('navigation receives events emitted synchronously by setGoal', () => {
	const bot = Object.assign(new EventEmitter(), {
		pathfinder: {
			setGoal(goal: unknown) {
				if (goal) bot.emit('goal_reached')
			}
		}
	})
	const { parent, events } = runService(primitiveNavigating, bot, {
		target: new Vec3(0, 64, 0)
	})
	try {
		assert.equal(events[0]?.type, 'ARRIVED')
	} finally {
		parent.stop()
	}
})

test('aborting breaking during drop spawn cannot replace the next movement owner', async () => {
	const goals: unknown[] = []
	let stops = 0
	const bot = Object.assign(new EventEmitter(), {
		tool: { equipForBlock: async () => {} },
		dig: async () => {},
		stopDigging: () => {
			stops++
		},
		utils: {
			countItemInInventory: () => 0,
			waitForInventoryChange: () => new Promise<boolean>(() => {})
		},
		entity: { position: new Vec3(0, 64, 0) },
		nearestEntity: () => ({ position: new Vec3(2, 64, 0) }),
		pathfinder: {
			setGoal: (goal: unknown) => {
				goals.push(goal)
			}
		}
	})
	const { parent } = runService(primitiveBreaking, bot, {
		block: { name: 'stone', position: new Vec3(1, 64, 0), drops: [1] }
	})
	await delay(10)
	parent.stop()
	goals.push('new owner')
	await delay(350)
	assert.equal(goals.at(-1), 'new owner')
	assert.equal(stops, 1)
})

test('aborting breaking during pickup cannot stop the next movement owner', async () => {
	const goals: unknown[] = []
	let finishPickup: (value: boolean) => void = () => {}
	const bot = Object.assign(new EventEmitter(), {
		tool: { equipForBlock: async () => {} },
		dig: async () => {},
		stopDigging() {},
		utils: {
			countItemInInventory: () => 0,
			waitForInventoryChange: () =>
				new Promise<boolean>(resolve => {
					finishPickup = resolve
				})
		},
		entity: { position: new Vec3(0, 64, 0) },
		nearestEntity: () => ({ position: new Vec3(2, 64, 0) }),
		pathfinder: {
			setGoal: (goal: unknown) => {
				goals.push(goal)
			}
		}
	})
	const { parent } = runService(primitiveBreaking, bot, {
		block: { name: 'stone', position: new Vec3(1, 64, 0), drops: [1] }
	})
	await delay(350)
	parent.stop()
	goals.push('new owner')
	finishPickup(true)
	await delay(0)
	assert.equal(goals.at(-1), 'new owner')
})
