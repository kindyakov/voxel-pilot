import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'
import { setImmediate as flushImmediate } from 'node:timers/promises'
import { setTimeout as delay } from 'node:timers/promises'

import { Vec3 } from 'vec3'
import { createActor, fromPromise } from 'xstate'
import type { AnyActorLogic } from 'xstate'

import { NoOpAgentClient } from '../../ai/client.js'
import type { AgentTurnResult } from '../../ai/contracts/agentTurn.js'
import { runAgentTurn } from '../../ai/loop.js'
import { createTaskContext } from '../../ai/taskContext.js'
import type { MachineContext } from '../../hsm/context.js'
import { createBotMachine } from '../../hsm/machine.js'
import type { Bot } from '../../types/index.js'
import { createEntityFixture, registry } from './fixtures/handoffBot'
import { publishEntities } from './fixtures/publishEntities'

test('model arguments rejected by the real turn are explained to the next HSM turn', async () => {
	const bot = new FakeBot()
	let turns = 0
	const actor = createActor(
		createBotMachine({
			thinkingActor: fromPromise(async ({ input, signal }) => {
				turns++
				if (turns > 1) {
					assert.equal(input.context.currentGoal, 'Travel')
					assert.match(input.context.lastReason ?? '', /range/)
				}
				return runAgentTurn({
					...input.context,
					bot: input.bot,
					memory: input.bot.memory,
					currentGoal: input.context.currentGoal!,
					windows: input.context.windows!,
					signal,
					client: {
						createResponse: async () => ({
							id: String(turns),
							outputText: '',
							toolCalls:
								turns === 1
									? [
											{
												callId: 'bad',
												name: 'navigate_to',
												arguments: {
													position: { x: 1, y: 64, z: 1 },
													range: 'near'
												}
											}
										]
									: [
											{
												callId: 'finish',
												name: 'finish_goal',
												arguments: { message: 'Corrected' }
											}
										]
						})
					}
				})
			}),
			actors: { serviceEntitiesTracking: noopActor }
		}),
		{ input: { bot: bot as unknown as Bot } }
	)
	bot.hsm = { getContext: () => actor.getSnapshot().context }
	actor.start()
	try {
		actor.send({ type: 'USER_COMMAND', username: 'Steve', text: 'Travel' })
		await waitForTurn()
		assert.equal(turns, 2)
		assert.equal(actor.getSnapshot().context.currentGoal, null)
	} finally {
		actor.stop()
	}
})

test('three rejected model actions terminate the goal without starting a primitive', async () => {
	const bot = new FakeBot()
	let turns = 0
	const actor = createActor(
		createBotMachine({
			thinkingActor: fromPromise(async () => {
				turns++
				return { kind: 'rejected', reason: 'Invalid action', transcript: [] }
			}),
			actors: { serviceEntitiesTracking: noopActor }
		}),
		{ input: { bot: bot as unknown as Bot } }
	)
	bot.hsm = { getContext: () => actor.getSnapshot().context }
	actor.start()
	try {
		actor.send({ type: 'USER_COMMAND', username: 'Steve', text: 'Travel' })
		await waitForTurn()
		assert.equal(turns, 3)
		assert.equal(actor.getSnapshot().context.currentGoal, null)
	} finally {
		actor.stop()
	}
})

test('transport failures pause a goal without exhausting its failure budget and resume it', async () => {
	let turns = 0
	const { actor } = createTestActor({
		thinkingActor: fromPromise(async () => {
			turns += 1
			if (turns <= 3) {
				return {
					kind: 'failed',
					reason: 'Connection refused',
					transcript: [],
					isTransport: true
				} satisfies AgentTurnResult
			}

			return await new Promise<never>(() => {})
		})
	})

	try {
		actor.send({ type: 'USER_COMMAND', username: 'Steve', text: 'Travel' })
		for (let failure = 0; failure < 3; failure += 1) {
			await waitForTurn()
			assert.equal(actor.getSnapshot().context.currentGoal, null)
			assert.equal(actor.getSnapshot().context.pausedGoal, 'Travel')
			assert.equal(
				actor.getSnapshot().context.goalExecution.consecutiveFailures,
				0
			)
			actor.send({ type: 'RESUME_PAUSED_GOAL' })
		}

		await waitForTurn()
		assert.equal(turns, 4)
		assert.equal(actor.getSnapshot().context.currentGoal, 'Travel')
		assert.equal(actor.getSnapshot().context.pausedGoal, null)
		assert.match(
			JSON.stringify(actor.getSnapshot().value),
			/"TASKS":"THINKING"/
		)
	} finally {
		actor.stop()
	}
})

test('NoOp failures pause the active goal without consuming budget', async () => {
	const { actor } = createTestActor({
		thinkingActor: noOpThinkingActor,
		aiPilotEnabled: false
	})

	try {
		actor.send({ type: 'USER_COMMAND', username: 'Steve', text: 'Travel' })
		await waitForTurn()

		assert.equal(actor.getSnapshot().context.currentGoal, null)
		assert.equal(actor.getSnapshot().context.pausedGoal, 'Travel')
		assert.equal(
			actor.getSnapshot().context.goalExecution.consecutiveFailures,
			0
		)
	} finally {
		actor.stop()
	}
})

test('transport actor errors pause while implementation bugs clear the goal', async () => {
	for (const scenario of [
		{
			name: 'transport',
			error: Object.assign(new Error('Model connection lost'), {
				code: 'ECONNRESET'
			}),
			pausedGoal: 'Travel'
		},
		{
			name: 'bug',
			error: new Error('Unexpected implementation bug'),
			pausedGoal: null
		}
	]) {
		const { actor } = createTestActor({
			thinkingActor: fromPromise(async () => {
				throw scenario.error
			}),
			aiPilotEnabled: false
		})

		try {
			actor.send({ type: 'USER_COMMAND', username: 'Steve', text: 'Travel' })
			await waitForTurn()

			assert.equal(actor.getSnapshot().context.currentGoal, null, scenario.name)
			assert.equal(
				actor.getSnapshot().context.pausedGoal,
				scenario.pausedGoal,
				scenario.name
			)
		} finally {
			actor.stop()
		}
	}
})

test('STOP cancellation cannot recreate the goal as paused', async () => {
	let started = false
	const { actor } = createTestActor({
		thinkingActor: fromPromise(async ({ signal }) => {
			started = true
			return await new Promise<never>((_resolve, reject) => {
				signal.addEventListener(
					'abort',
					() => reject(new DOMException('Cancelled', 'AbortError')),
					{ once: true }
				)
			})
		})
	})

	try {
		actor.send({ type: 'USER_COMMAND', username: 'Steve', text: 'Travel' })
		await flushImmediate()
		assert.equal(started, true)
		actor.send({ type: 'STOP_CURRENT_GOAL', username: 'Steve' })
		await flushImmediate()

		assert.equal(actor.getSnapshot().context.currentGoal, null)
		assert.equal(actor.getSnapshot().context.pausedGoal, null)
	} finally {
		actor.stop()
	}
})

test('paused goals automatically resume from IDLE after the configured delay', async t => {
	t.mock.timers.enable({ apis: ['setTimeout'] })
	let turns = 0
	const { actor } = createTestActor({
		preferences: { pausedGoalRetryMs: 30_000 },
		thinkingActor: fromPromise(async () => {
			turns += 1
			if (turns === 1) {
				return {
					kind: 'failed',
					reason: 'Temporary transport outage',
					transcript: [],
					isTransport: true
				} satisfies AgentTurnResult
			}
			return await new Promise<never>(() => {})
		})
	})

	try {
		actor.send({ type: 'USER_COMMAND', username: 'Steve', text: 'Travel' })
		await flushImmediate()
		await flushImmediate()
		assert.equal(actor.getSnapshot().context.pausedGoal, 'Travel')

		t.mock.timers.tick(29_999)
		await flushImmediate()
		assert.equal(turns, 1)

		t.mock.timers.tick(1)
		await flushImmediate()
		assert.equal(turns, 2)
		assert.equal(actor.getSnapshot().context.currentGoal, 'Travel')
		assert.equal(actor.getSnapshot().context.pausedGoal, null)
	} finally {
		actor.stop()
	}
})

test('a new goal replaces the paused goal and STOP cancels its pending retry', async t => {
	t.mock.timers.enable({ apis: ['setTimeout'] })
	let turns = 0
	const { actor } = createTestActor({
		preferences: { pausedGoalRetryMs: 30_000 },
		thinkingActor: fromPromise(async () => {
			turns += 1
			if (turns === 1) {
				return {
					kind: 'failed',
					reason: 'Temporary transport outage',
					transcript: [],
					isTransport: true
				} satisfies AgentTurnResult
			}
			return await new Promise<never>(() => {})
		})
	})

	try {
		actor.send({ type: 'USER_COMMAND', username: 'Steve', text: 'Old goal' })
		await flushImmediate()
		await flushImmediate()
		assert.equal(actor.getSnapshot().context.pausedGoal, 'Old goal')

		actor.send({ type: 'USER_COMMAND', username: 'Steve', text: 'New goal' })
		await flushImmediate()
		assert.equal(turns, 2)
		assert.equal(actor.getSnapshot().context.currentGoal, 'New goal')
		assert.equal(actor.getSnapshot().context.pausedGoal, null)

		actor.send({ type: 'STOP_CURRENT_GOAL', username: 'Steve' })
		t.mock.timers.tick(30_000)
		await flushImmediate()
		assert.equal(turns, 2)
		assert.equal(actor.getSnapshot().context.currentGoal, null)
		assert.equal(actor.getSnapshot().context.pausedGoal, null)
	} finally {
		actor.stop()
	}
})

test('disabled AI leaves autonomous healing and armed combat operational', async () => {
	let thinkingCalls = 0
	const noOpClient = new NoOpAgentClient('disabled')
	const { actor } = createTestActor({
		aiPilotEnabled: false,
		thinkingActor: fromPromise(async () => {
			thinkingCalls += 1
			return noOpClient.createResponse({
				instructions: '',
				input: '',
				tools: []
			})
		})
	})

	try {
		actor.send({ type: 'UPDATE_HEALTH', health: 8 })
		assert.match(
			JSON.stringify(actor.getSnapshot().value),
			/"EMERGENCY_HEALING":"RUNNING"/
		)
		assert.equal(thinkingCalls, 0)

		actor.send({ type: 'UPDATE_HEALTH', health: 20 })
		actor.send({ type: 'HEALTH_RESTORED' })
		actor.send({
			type: 'UPDATE_ENTITIES',
			entities: [enemy],
			enemies: [enemy],
			players: []
		})
		actor.send({
			type: 'UPDATE_COMBAT_TARGET',
			combatTarget: { entity: enemy, distance: 2 }
		})
		await waitForTurn()
		assert.match(
			JSON.stringify(actor.getSnapshot().value),
			/"COMBAT":"MELEE_ATTACKING"/
		)
		assert.equal(thinkingCalls, 0)
	} finally {
		actor.stop()
	}
})

const createVec3 = (x: number, y: number, z: number) => ({
	x,
	y,
	z,
	distanceTo(other: { x: number; y: number; z: number }) {
		const dx = x - other.x
		const dy = y - other.y
		const dz = z - other.z
		return Math.sqrt(dx * dx + dy * dy + dz * dz)
	},
	offset(dx: number, dy: number, dz: number) {
		return createVec3(x + dx, y + dy, z + dz)
	},
	minus(other: { x: number; y: number; z: number }) {
		return {
			x: x - other.x,
			y: y - other.y,
			z: z - other.z,
			normalize() {
				const length = Math.sqrt(
					this.x * this.x + this.y * this.y + this.z * this.z
				)
				return createVec3(this.x / length, this.y / length, this.z / length)
			}
		}
	}
})

// Match Mineflayer's local window acquisition/release, including close failures.
const trackWindow = (
	bot: { currentWindow?: unknown },
	window: unknown
): unknown => {
	assert.ok(
		window &&
			typeof window === 'object' &&
			'close' in window &&
			typeof window.close === 'function'
	)
	const close = window.close.bind(window)
	window.close = () => {
		close()
		bot.currentWindow = null
	}
	bot.currentWindow = window
	return window
}

class FakeBot extends EventEmitter {
	username = 'Bot'
	entity = { id: 999, position: createVec3(0, 64, 0), height: 1.8 }
	entities = {}
	health = 20
	food = 20
	foodSaturation = 5
	oxygenLevel = 20
	inventory = {
		slots: Array.from({ length: 46 }, () => null),
		items: () => []
	}
	registry = registry
	movement = {
		goals: {
			Default: { id: 'default-goal' }
		},
		heuristic: {
			get: () => ({
				target: () => ({
					avoid: () => {}
				}),
				avoid: () => {}
			})
		},
		setGoal: () => {},
		getYaw: () => 0,
		steer: async () => {}
	}
	game = { dimension: 'overworld' }
	time = { isDay: true, timeOfDay: 1000 }
	autoEat = {
		foodsByName: {},
		opts: { bannedFood: [] },
		findBestChoices: () => [],
		isEating: false
	}
	pathfinder = {
		goals: [] as unknown[],
		setGoal: (goal: unknown) => {
			this.pathfinder.goals.push(goal)
		}
	}
	movements = {
		allowSprinting: true
	}
	controlStates = new Map<string, boolean>()
	pvpAttackCalls = 0
	pvpStopCalls = 0
	pvpForceStopCalls = 0
	hawkEyeStopCalls = 0
	hawkEyeAttackCalls = 0
	hawkEye = {
		stop: () => {
			this.hawkEyeStopCalls += 1
		},
		autoAttack: () => {
			this.hawkEyeAttackCalls += 1
		}
	}
	tool = {
		equipForBlock: async () => {}
	}
	armorManager = {}
	pvp = {
		target: undefined as any,
		attack: (enemy?: any) => {
			this.pvpAttackCalls += 1
			this.pvp.target = enemy
		},
		stop: () => {
			this.pvpStopCalls += 1
			this.pvp.target = undefined
		},
		forceStop: () => {
			this.pvpForceStopCalls += 1
			this.pvp.target = undefined
		}
	}
	utils = {
		getAllFood: () => [{ name: 'bread' }],
		eating: async () => {},
		stopEating: () => {},
		findNearestEnemy: () => null,
		getMeleeWeapon: () => ({ name: 'iron_sword' }),
		getRangeWeapon: () => null,
		getArrow: () => null,
		searchPlayer: () => null,
		countItemInInventory: () => 0
	}
	memory = {
		load: async () => {},
		save: async () => {},
		close: () => {},
		readEntries: () => [],
		saveEntry: () => null,
		updateEntryData: () => null,
		deleteEntry: () => false
	}
	hsm: any
	chatMessages: string[] = []

	chat(message: string) {
		this.chatMessages.push(message)
	}
	quit() {}
	loadPlugin() {}
	async dig() {}
	stopDigging() {}
	async placeBlock() {}
	async equip() {}
	async consume() {}
	async craft() {}
	recipesFor() {
		return []
	}
	async sleep() {}
	blockAt() {
		return null
	}
	findBlocks() {
		return []
	}
	nearestEntity() {
		return null
	}
	getEquipmentDestSlot() {
		return 36
	}
	async openChest() {
		return {
			slots: [],
			close() {},
			containerItems() {
				return []
			},
			findItemRangeName() {
				return null
			}
		}
	}
	async openContainer() {
		return {
			slots: [],
			close() {},
			containerItems() {
				return []
			},
			findItemRangeName() {
				return null
			}
		}
	}
	async openFurnace() {
		return {
			slots: [],
			close() {},
			containerItems() {
				return []
			},
			findItemRangeName() {
				return null
			}
		}
	}
	async openBlock() {
		return {
			slots: [],
			close() {},
			containerItems() {
				return []
			},
			findItemRangeName() {
				return null
			}
		}
	}
	async transfer() {}
	closeWindow() {}
	setControlState(control: string, state: boolean) {
		this.controlStates.set(control, state)
	}
}

const hangingActor = fromPromise(async () => {
	return await new Promise<never>(() => {})
})

const noopActor = fromPromise(async () => {})

const noOpThinkingActor = fromPromise<
	AgentTurnResult,
	{ bot: Bot; context: MachineContext }
>(async ({ input, signal }) => {
	if (!input.context.currentGoal) {
		throw new Error('Expected an active goal')
	}

	return runAgentTurn({
		bot: input.bot,
		memory: input.bot.memory,
		currentGoal: input.context.currentGoal,
		subGoal: input.context.subGoal,
		conversationHistory: input.context.conversationHistory,
		lastAction: input.context.lastAction,
		lastResult: input.context.lastResult,
		lastReason: input.context.lastReason,
		errorHistory: input.context.errorHistory,
		taskContext: input.context.taskContext,
		windows: input.context.windows!,
		signal,
		client: new NoOpAgentClient('disabled')
	})
})

const enemy = createEntityFixture({
	id: 1,
	type: 'hostile',
	name: 'zombie',
	position: new Vec3(2, 64, 0),
	isValid: true
})

interface TestActorOptions {
	thinkingActor?: AnyActorLogic
	aiPilotEnabled?: boolean
	preferences?: Partial<MachineContext['preferences']>
}

const createTestActor = (options: TestActorOptions = {}) => {
	const bot = new FakeBot() as any
	const actor = createActor(
		createBotMachine({
			thinkingActor: options.thinkingActor ?? hangingActor,
			preferences: options.preferences,
			actors: {
				serviceEntitiesTracking: noopActor,
				serviceMeleeAttack: noopActor,
				serviceRangedSkirmish: noopActor,
				serviceFleeing: noopActor,
				serviceEmergencyEating: hangingActor,
				serviceEmergencyHealing: hangingActor
			}
		}),
		{
			input: { bot, aiPilotEnabled: options.aiPilotEnabled }
		}
	)

	bot.hsm = {
		getContext: () => actor.getSnapshot().context
	}

	actor.start()
	// The test observer has completed an empty-world scan.
	actor.send({
		type: 'UPDATE_ENTITIES',
		entities: [],
		enemies: [],
		players: []
	})
	return { bot, actor }
}

const waitForTurn = async () => {
	await delay(0)
	await delay(0)
}

test('critical updates do not restart recovery or overwrite its return destination', async () => {
	const { actor } = createTestActor()
	try {
		actor.send({ type: 'USER_COMMAND', username: 'Steve', text: 'Gather food' })
		actor.send({ type: 'UPDATE_HEALTH', health: 8 })
		const recovery = Object.values(actor.getSnapshot().children).find(child =>
			child?.id.includes('EMERGENCY_HEALING')
		)
		assert.ok(recovery)
		actor.send({ type: 'UPDATE_HEALTH', health: 6 })
		assert.equal(
			Object.values(actor.getSnapshot().children).find(child =>
				child?.id.includes('EMERGENCY_HEALING')
			),
			recovery
		)
		actor.send({ type: 'UPDATE_FOOD', food: 5 })
		assert.ok(
			actor
				.getSnapshot()
				.matches({ MAIN_ACTIVITY: { URGENT_NEEDS: 'EMERGENCY_HEALING' } })
		)
		actor.send({ type: 'UPDATE_HEALTH', health: 20 })
		actor.send({ type: 'UPDATE_FOOD', food: 20 })
		actor.send({
			type: 'UPDATE_ENTITIES',
			entities: [],
			enemies: [],
			players: []
		})
		actor.send({ type: 'HEALTH_RESTORED' })
		assert.ok(
			actor.getSnapshot().matches({ MAIN_ACTIVITY: { TASKS: 'THINKING' } })
		)
	} finally {
		actor.stop()
	}
})

test('recovery replans an interrupted navigation without executing empty arguments', async () => {
	const bot = new FakeBot() as any
	let turns = 0
	const actor = createActor(
		createBotMachine({
			thinkingActor: fromPromise(async () =>
				++turns === 1
					? {
							kind: 'execute',
							execution: {
								toolName: 'navigate_to',
								args: { position: { x: 10, y: 64, z: 0 } }
							},
							subGoal: 'Travel',
							transcript: []
						}
					: new Promise(() => {})
			),
			actors: {
				serviceEntitiesTracking: noopActor,
				serviceEmergencyHealing: hangingActor
			}
		}),
		{ input: { bot } }
	)
	bot.hsm = { getContext: () => actor.getSnapshot().context }
	actor.start()
	try {
		actor.send({ type: 'USER_COMMAND', username: 'Steve', text: 'Travel' })
		await waitForTurn()
		actor.send({ type: 'UPDATE_HEALTH', health: 8 })
		actor.send({ type: 'UPDATE_HEALTH', health: 20 })
		actor.send({
			type: 'UPDATE_ENTITIES',
			entities: [],
			enemies: [],
			players: []
		})
		actor.send({ type: 'HEALTH_RESTORED' })
		await waitForTurn()
		assert.equal(turns, 2)
		assert.equal(
			actor.getSnapshot().context.goalExecution.consecutiveFailures,
			0
		)
		assert.notEqual(
			actor.getSnapshot().context.lastReason,
			'Unknown execution failure'
		)
	} finally {
		actor.stop()
	}
})

test('alternating failed executions exhaust the task failure budget', async () => {
	const bot = new FakeBot() as any
	let turns = 0
	const actor = createActor(
		createBotMachine({
			thinkingActor: fromPromise(async () => ({
				kind: 'execute',
				execution: {
					toolName: 'navigate_to',
					args: { position: { x: (++turns % 2) + 10, y: 64, z: 0 } }
				},
				subGoal: 'Travel',
				transcript: []
			})),
			actors: { serviceEntitiesTracking: noopActor }
		}),
		{ input: { bot } }
	)
	bot.hsm = { getContext: () => actor.getSnapshot().context }
	actor.start()
	try {
		actor.send({ type: 'USER_COMMAND', username: 'Steve', text: 'Travel' })
		for (
			let index = 0;
			index < 6 && actor.getSnapshot().context.currentGoal;
			index++
		) {
			await waitForTurn()
			actor.send({ type: 'NAVIGATION_FAILED', reason: 'Unreachable' })
		}
		assert.equal(actor.getSnapshot().context.currentGoal, null)
		assert.ok(turns <= 6)
	} finally {
		actor.stop()
	}
})

test('successful ping-pong executions cannot run a goal forever', async () => {
	const bot = new FakeBot() as any
	let turns = 0
	const actor = createActor(
		createBotMachine({
			thinkingActor: fromPromise(async () => ({
				kind: 'execute',
				execution: {
					toolName: 'navigate_to',
					args: { position: { x: (++turns % 2) + 10, y: 64, z: 0 } }
				},
				subGoal: 'Travel',
				transcript: []
			})),
			actors: { serviceEntitiesTracking: noopActor }
		}),
		{ input: { bot } }
	)
	bot.hsm = { getContext: () => actor.getSnapshot().context }
	actor.start()
	try {
		actor.send({ type: 'USER_COMMAND', username: 'Steve', text: 'Travel' })
		for (
			let index = 0;
			index < 129 && actor.getSnapshot().context.currentGoal;
			index++
		) {
			await waitForTurn()
			actor.send({ type: 'ARRIVED' })
		}
		assert.equal(actor.getSnapshot().context.currentGoal, null)
		assert.equal(turns, 128)
	} finally {
		actor.stop()
	}
})

test('interrupting the last allowed action cannot issue action 129 after recovery', async () => {
	const bot = new FakeBot() as any
	let turns = 0
	const actor = createActor(
		createBotMachine({
			thinkingActor: fromPromise(async () => ({
				kind: 'execute',
				execution: {
					toolName: 'navigate_to',
					args: { position: { x: (++turns % 2) + 10, y: 64, z: 0 } }
				},
				subGoal: 'Travel',
				transcript: []
			})),
			actors: {
				serviceEntitiesTracking: noopActor,
				serviceEmergencyHealing: hangingActor
			}
		}),
		{ input: { bot } }
	)
	bot.hsm = { getContext: () => actor.getSnapshot().context }
	actor.start()
	try {
		actor.send({ type: 'USER_COMMAND', username: 'Steve', text: 'Travel' })
		for (
			let index = 0;
			index < 127 && actor.getSnapshot().context.currentGoal;
			index++
		) {
			await waitForTurn()
			actor.send({ type: 'ARRIVED' })
		}
		await waitForTurn()
		assert.equal(actor.getSnapshot().context.goalExecution.attempts, 128)
		actor.send({ type: 'UPDATE_HEALTH', health: 8 })
		assert.equal(actor.getSnapshot().context.goalExecution.attempts, 128)
		actor.send({ type: 'UPDATE_HEALTH', health: 20 })
		actor.send({
			type: 'UPDATE_ENTITIES',
			entities: [],
			enemies: [],
			players: []
		})
		actor.send({ type: 'HEALTH_RESTORED' })
		await waitForTurn()
		assert.equal(actor.getSnapshot().context.currentGoal, null)
		assert.equal(turns, 128)
	} finally {
		actor.stop()
	}
})

test('late cleanup of an old window does not complete the new execution', async () => {
	const bot = new FakeBot() as any
	let resolveOpen: (value: unknown) => void = () => {}
	let turns = 0
	bot.blockAt = () => ({ name: 'furnace', position: createVec3(1, 64, 1) })
	bot.openFurnace = async () =>
		trackWindow(
			bot,
			await (() =>
				new Promise<{ slots: unknown[]; close(): void }>(resolve => {
					resolveOpen = value =>
						resolve(value as { slots: unknown[]; close(): void })
				}))()
		)
	const actor = createActor(
		createBotMachine({
			thinkingActor: fromPromise(async () => ({
				kind: 'execute',
				execution:
					++turns === 1
						? {
								toolName: 'open_window',
								args: { position: { x: 1, y: 64, z: 1 } }
							}
						: {
								toolName: 'navigate_to',
								args: { position: { x: 10, y: 64, z: 0 } }
							},
				subGoal: 'Work',
				transcript: []
			})),
			actors: { serviceEntitiesTracking: noopActor }
		}),
		{ input: { bot } }
	)
	bot.hsm = {
		getContext: () => actor.getSnapshot().context,
		send: (event: any) => actor.send(event)
	}
	actor.start()
	try {
		actor.send({ type: 'USER_COMMAND', username: 'Steve', text: 'Open' })
		await waitForTurn()
		actor.send({ type: 'USER_COMMAND', username: 'Steve', text: 'Travel' })
		await waitForTurn()
		const pending = actor.getSnapshot().context.pendingExecution
		resolveOpen({
			slots: [],
			close() {
				throw new Error('close failed')
			}
		})
		await waitForTurn()
		assert.equal(actor.getSnapshot().context.pendingExecution, pending)
		assert.equal(actor.getSnapshot().context.lastResult, null)
		assert.equal(
			actor.getSnapshot().context.windows!.getSnapshot().state,
			'close_failed'
		)
	} finally {
		actor.stop()
	}
})

const waitUntil = async (predicate: () => boolean, attempts = 40) => {
	for (let attempt = 0; attempt < attempts; attempt += 1) {
		await delay(25)
		if (predicate()) {
			return
		}
	}
}

test('machine enters TASKS.THINKING on USER_COMMAND', async () => {
	const { actor } = createTestActor()

	try {
		actor.send({
			type: 'USER_COMMAND',
			username: 'Steve',
			text: 'Build a shelter'
		})
		await waitForTurn()

		assert.equal(
			actor
				.getSnapshot()
				.matches({ MAIN_ACTIVITY: { TASKS: 'THINKING' } } as never),
			true
		)
	} finally {
		actor.stop()
	}
})

test('combat returns to TASKS.THINKING when a goal exists', async () => {
	const { actor } = createTestActor()

	try {
		actor.send({
			type: 'USER_COMMAND',
			username: 'Steve',
			text: 'Follow the target'
		})
		await waitForTurn()

		actor.send({
			type: 'START_COMBAT',
			target: enemy as any
		})
		await waitForTurn()

		assert.equal(
			actor.getSnapshot().matches({ MAIN_ACTIVITY: 'COMBAT' } as never),
			true
		)

		actor.send({ type: 'NO_ENEMIES' })
		await waitForTurn()

		assert.equal(
			actor
				.getSnapshot()
				.matches({ MAIN_ACTIVITY: { TASKS: 'THINKING' } } as never),
			true
		)
	} finally {
		actor.stop()
	}
})

test('combat returns to IDLE when there is no active goal', async () => {
	const { actor } = createTestActor()

	try {
		actor.send({
			type: 'START_COMBAT',
			target: enemy as any
		})
		await waitForTurn()

		assert.equal(
			actor.getSnapshot().matches({ MAIN_ACTIVITY: 'COMBAT' } as never),
			true
		)

		actor.send({ type: 'NO_ENEMIES' })
		await waitForTurn()

		assert.equal(
			actor.getSnapshot().matches({ MAIN_ACTIVITY: 'IDLE' } as never),
			true
		)
	} finally {
		actor.stop()
	}
})

test('START_COMBAT seeds combatTarget from the event target', async () => {
	const { actor } = createTestActor()

	try {
		actor.send({
			type: 'START_COMBAT',
			target: enemy as any
		})
		await waitForTurn()

		assert.equal(actor.getSnapshot().context.combatTarget.entity, enemy)
		assert.equal(actor.getSnapshot().context.combatTarget.distance, 2)
	} finally {
		actor.stop()
	}
})

test('STOP_COMBAT returns to TASKS.THINKING when a goal exists', async () => {
	const { actor } = createTestActor()

	try {
		actor.send({
			type: 'USER_COMMAND',
			username: 'Steve',
			text: 'Follow the target'
		})
		await waitForTurn()

		actor.send({
			type: 'START_COMBAT',
			target: enemy as any
		})
		await waitForTurn()

		assert.equal(
			actor.getSnapshot().matches({ MAIN_ACTIVITY: 'COMBAT' } as never),
			true
		)

		actor.send({ type: 'STOP_COMBAT' })
		await waitForTurn()

		assert.equal(
			actor
				.getSnapshot()
				.matches({ MAIN_ACTIVITY: { TASKS: 'THINKING' } } as never),
			true
		)
	} finally {
		actor.stop()
	}
})

test('STOP_COMBAT suppresses auto re-entry into combat until enemies are gone', async () => {
	const { actor } = createTestActor()

	try {
		actor.send({
			type: 'START_COMBAT',
			target: enemy as any
		})
		await waitForTurn()

		actor.send({ type: 'STOP_COMBAT' })
		await waitForTurn()

		publishEntities(actor, {
			type: 'UPDATE_ENTITIES',
			entities: [enemy as any],
			enemies: [enemy as any],
			players: [],
			combatTarget: {
				entity: enemy as any,
				distance: 2
			}
		})
		await waitForTurn()

		assert.equal(
			actor.getSnapshot().matches({ MAIN_ACTIVITY: 'IDLE' } as never),
			true
		)
	} finally {
		actor.stop()
	}
})

test('autoDefend false prevents entity updates from forcing combat entry', async () => {
	const bot = new FakeBot() as any
	const actor = createActor(
		createBotMachine({
			thinkingActor: hangingActor,
			actors: {
				serviceEntitiesTracking: noopActor,
				serviceMeleeAttack: noopActor,
				serviceRangedSkirmish: noopActor,
				serviceFleeing: noopActor,
				serviceEmergencyEating: hangingActor,
				serviceEmergencyHealing: hangingActor
			}
		}),
		{
			input: { bot }
		}
	)

	bot.hsm = {
		getContext: () => actor.getSnapshot().context
	}

	actor.start()

	try {
		actor.getSnapshot().context.preferences.autoDefend = false
		publishEntities(actor, {
			type: 'UPDATE_ENTITIES',
			entities: [enemy as any],
			enemies: [enemy as any],
			players: [],
			combatTarget: {
				entity: enemy as any,
				distance: 2
			}
		})
		await waitForTurn()

		assert.equal(
			actor.getSnapshot().matches({ MAIN_ACTIVITY: 'IDLE' } as never),
			true
		)
	} finally {
		actor.stop()
	}
})

test('NO_ENEMIES clears combatTarget before returning to thinking', async () => {
	const { actor } = createTestActor()

	try {
		actor.send({
			type: 'USER_COMMAND',
			username: 'Steve',
			text: 'Follow the target'
		})
		await waitForTurn()

		actor.send({
			type: 'START_COMBAT',
			target: enemy as any
		})
		await waitForTurn()

		actor.send({ type: 'NO_ENEMIES' })
		await waitForTurn()

		assert.equal(actor.getSnapshot().context.combatTarget.entity, null)
		assert.equal(actor.getSnapshot().context.combatTarget.distance, Infinity)
	} finally {
		actor.stop()
	}
})

test('combat falls back to MELEE_ATTACKING when ranged mode is unavailable', async () => {
	const { actor } = createTestActor()

	try {
		actor.send({
			type: 'START_COMBAT',
			target: {
				...enemy,
				position: createVec3(8, 64, 0)
			} as any
		})
		await waitForTurn()

		assert.equal(
			actor.getSnapshot().matches({
				MAIN_ACTIVITY: { COMBAT: 'MELEE_ATTACKING' }
			} as never),
			true
		)
		assert.equal(actor.getSnapshot().context.movementOwner, 'PVP')
	} finally {
		actor.stop()
	}
})

test('combat chooses RANGED_SKIRMISHING when ranged window is valid', async () => {
	const bot = new FakeBot() as any
	bot.utils.getRangeWeapon = () => ({ name: 'bow' })
	bot.utils.getArrow = () => ({ name: 'arrow' })

	const actor = createActor(
		createBotMachine({
			thinkingActor: hangingActor,
			actors: {
				serviceEntitiesTracking: noopActor,
				serviceMeleeAttack: noopActor,
				serviceRangedSkirmish: noopActor,
				serviceFleeing: noopActor,
				serviceEmergencyEating: hangingActor,
				serviceEmergencyHealing: hangingActor
			}
		}),
		{
			input: { bot }
		}
	)

	bot.hsm = {
		getContext: () => actor.getSnapshot().context
	}

	actor.start()

	try {
		actor.send({
			type: 'START_COMBAT',
			target: {
				...enemy,
				position: createVec3(8, 64, 0)
			} as any
		})
		await waitForTurn()

		assert.equal(
			actor.getSnapshot().matches({
				MAIN_ACTIVITY: { COMBAT: 'RANGED_SKIRMISHING' }
			} as never),
			true
		)
		assert.equal(actor.getSnapshot().context.movementOwner, 'NONE')
	} finally {
		actor.stop()
	}
})

test('combat chooses MELEE_ATTACKING in close range and assigns pvp ownership', async () => {
	const { actor } = createTestActor()

	try {
		actor.send({
			type: 'START_COMBAT',
			target: enemy as any
		})
		await waitForTurn()

		assert.equal(
			actor.getSnapshot().matches({
				MAIN_ACTIVITY: { COMBAT: 'MELEE_ATTACKING' }
			} as never),
			true
		)
		assert.equal(actor.getSnapshot().context.movementOwner, 'PVP')
	} finally {
		actor.stop()
	}
})

test('combat chooses the nearer hostile instead of locking the initial target', async () => {
	const bot = new FakeBot() as any
	bot.utils.getRangeWeapon = () => ({ name: 'bow' })
	bot.utils.getArrow = () => ({ name: 'arrow' })

	const actor = createActor(
		createBotMachine({
			thinkingActor: hangingActor,
			actors: {
				serviceEntitiesTracking: noopActor,
				serviceMeleeAttack: noopActor,
				serviceRangedSkirmish: noopActor,
				serviceFleeing: noopActor,
				serviceEmergencyEating: hangingActor,
				serviceEmergencyHealing: hangingActor
			}
		}),
		{
			input: { bot }
		}
	)

	bot.hsm = {
		getContext: () => actor.getSnapshot().context
	}

	actor.start()
	const enemyA = {
		...enemy,
		id: 101,
		position: createVec3(8, 64, 0)
	}
	const enemyB = {
		...enemy,
		id: 102,
		position: createVec3(6, 64, 0)
	}

	try {
		actor.send({
			type: 'START_COMBAT',
			target: enemyA as any
		})
		await waitForTurn()
		await waitForTurn()

		assert.equal(
			actor.getSnapshot().matches({
				MAIN_ACTIVITY: 'COMBAT'
			} as never),
			true
		)
		assert.equal(actor.getSnapshot().context.preferredCombatTargetId, enemyA.id)

		publishEntities(actor, {
			type: 'UPDATE_ENTITIES',
			entities: [enemyA as any, enemyB as any],
			enemies: [enemyA as any, enemyB as any],
			players: [],
			combatTarget: {
				entity: enemyB as any,
				distance: 6
			}
		})
		await waitForTurn()

		assert.equal(actor.getSnapshot().context.preferredCombatTargetId, enemyA.id)
		assert.equal(actor.getSnapshot().context.combatTarget.entity?.id, enemyB.id)
	} finally {
		actor.stop()
	}
})

test('melee combat does not thrash into ranged skirmish on small distance jitter', async () => {
	const bot = new FakeBot() as any
	bot.utils.getRangeWeapon = () => ({ name: 'bow' })
	bot.utils.getArrow = () => ({ name: 'arrow' })

	const actor = createActor(
		createBotMachine({
			thinkingActor: hangingActor,
			actors: {
				serviceEntitiesTracking: noopActor,
				serviceMeleeAttack: noopActor,
				serviceRangedSkirmish: noopActor,
				serviceFleeing: noopActor,
				serviceEmergencyEating: hangingActor,
				serviceEmergencyHealing: hangingActor
			}
		}),
		{
			input: { bot }
		}
	)

	bot.hsm = {
		getContext: () => actor.getSnapshot().context
	}

	actor.start()

	try {
		actor.send({
			type: 'START_COMBAT',
			target: enemy as any
		})
		await waitForTurn()

		assert.equal(
			actor.getSnapshot().matches({
				MAIN_ACTIVITY: { COMBAT: 'MELEE_ATTACKING' }
			} as never),
			true
		)

		publishEntities(actor, {
			type: 'UPDATE_ENTITIES',
			entities: [
				{
					...enemy,
					position: createVec3(5.2, 64, 0)
				} as any
			],
			enemies: [
				{
					...enemy,
					position: createVec3(5.2, 64, 0)
				} as any
			],
			players: [],
			combatTarget: {
				entity: {
					...enemy,
					position: createVec3(5.2, 64, 0)
				} as any,
				distance: 5.2
			}
		})
		await waitForTurn()

		assert.equal(
			actor.getSnapshot().matches({
				MAIN_ACTIVITY: { COMBAT: 'MELEE_ATTACKING' }
			} as never),
			true
		)
	} finally {
		actor.stop()
	}
})

test('urgent needs returns to TASKS.THINKING when a goal exists', async () => {
	const { actor } = createTestActor()

	try {
		actor.send({
			type: 'USER_COMMAND',
			username: 'Steve',
			text: 'Gather wood'
		})
		await waitForTurn()

		actor.send({
			type: 'START_URGENT_NEEDS',
			need: 'food'
		})
		await waitForTurn()

		assert.equal(
			actor.getSnapshot().matches({ MAIN_ACTIVITY: 'URGENT_NEEDS' } as never),
			true
		)

		actor.send({
			type: 'UPDATE_ENTITIES',
			entities: [],
			enemies: [],
			players: []
		})

		actor.send({ type: 'FOOD_RESTORED' })
		await waitForTurn()

		assert.equal(
			actor
				.getSnapshot()
				.matches({ MAIN_ACTIVITY: { TASKS: 'THINKING' } } as never),
			true
		)
	} finally {
		actor.stop()
	}
})

test('urgent needs returns to IDLE when there is no active goal', async () => {
	const { actor } = createTestActor()

	try {
		actor.send({
			type: 'START_URGENT_NEEDS',
			need: 'health'
		})
		await waitForTurn()

		assert.equal(
			actor.getSnapshot().matches({ MAIN_ACTIVITY: 'URGENT_NEEDS' } as never),
			true
		)

		actor.send({
			type: 'UPDATE_ENTITIES',
			entities: [],
			enemies: [],
			players: []
		})

		actor.send({ type: 'HEALTH_RESTORED' })
		await waitForTurn()

		assert.equal(
			actor.getSnapshot().matches({ MAIN_ACTIVITY: 'IDLE' } as never),
			true
		)
	} finally {
		actor.stop()
	}
})

test('UPDATE_HEALTH preempts combat into urgent healing while a melee threat is active', async () => {
	const { actor } = createTestActor()

	try {
		actor.send({
			type: 'START_COMBAT',
			target: enemy as any
		})
		await waitForTurn()
		await waitForTurn()

		assert.equal(
			actor
				.getSnapshot()
				.matches({ MAIN_ACTIVITY: { COMBAT: 'MELEE_ATTACKING' } } as never),
			true
		)

		actor.send({
			type: 'UPDATE_HEALTH',
			health: 8
		})
		await waitForTurn()
		await waitForTurn()

		assert.equal(actor.getSnapshot().context.health, 8)
		assert.equal(
			actor.getSnapshot().matches({
				MAIN_ACTIVITY: { URGENT_NEEDS: 'EMERGENCY_HEALING' }
			} as never),
			true
		)
	} finally {
		actor.stop()
	}
})

test('critical food preempts active melee combat even while the hostile is close', async () => {
	const { actor } = createTestActor()

	try {
		actor.send({
			type: 'START_COMBAT',
			target: enemy as any
		})
		await waitForTurn()
		await waitForTurn()

		assert.equal(
			actor.getSnapshot().matches({
				MAIN_ACTIVITY: { COMBAT: 'MELEE_ATTACKING' }
			} as never),
			true
		)

		actor.send({
			type: 'UPDATE_FOOD',
			food: 5
		})
		await waitForTurn()
		await waitForTurn()

		assert.equal(actor.getSnapshot().context.food, 5)
		assert.equal(
			actor.getSnapshot().matches({
				MAIN_ACTIVITY: { URGENT_NEEDS: 'EMERGENCY_EATING' }
			} as never),
			true
		)
	} finally {
		actor.stop()
	}
})

test('URGENT_NEEDS remains sticky on UPDATE_ENTITIES while emergency recovery is unresolved', async () => {
	const { actor } = createTestActor()

	try {
		actor.send({
			type: 'START_COMBAT',
			target: enemy as any
		})
		await waitForTurn()
		await waitForTurn()

		actor.send({
			type: 'UPDATE_HEALTH',
			health: 8
		})
		await waitForTurn()
		await waitForTurn()

		assert.equal(
			actor.getSnapshot().matches({
				MAIN_ACTIVITY: { URGENT_NEEDS: 'EMERGENCY_HEALING' }
			} as never),
			true
		)

		publishEntities(actor, {
			type: 'UPDATE_ENTITIES',
			entities: [enemy as any],
			enemies: [enemy as any],
			players: [],
			combatTarget: {
				entity: enemy as any,
				distance: 2
			}
		})
		await waitForTurn()
		await waitForTurn()

		assert.equal(
			actor.getSnapshot().matches({
				MAIN_ACTIVITY: { URGENT_NEEDS: 'EMERGENCY_HEALING' }
			} as never),
			true
		)
	} finally {
		actor.stop()
	}
})

test('URGENT_NEEDS replans the saved goal only after health has actually recovered', async () => {
	const { actor } = createTestActor()

	try {
		actor.send({
			type: 'USER_COMMAND',
			username: 'Steve',
			text: 'Gather wood'
		})
		await waitForTurn()
		await waitForTurn()

		actor.send({
			type: 'UPDATE_HEALTH',
			health: 8
		})
		await waitForTurn()
		await waitForTurn()

		assert.equal(
			actor.getSnapshot().matches({
				MAIN_ACTIVITY: { URGENT_NEEDS: 'EMERGENCY_HEALING' }
			} as never),
			true
		)

		actor.send({ type: 'UPDATE_HEALTH', health: 18 })
		actor.send({
			type: 'UPDATE_ENTITIES',
			entities: [],
			enemies: [],
			players: []
		})
		actor.send({ type: 'HEALTH_RESTORED' })
		await waitForTurn()
		await waitForTurn()

		assert.equal(
			actor.getSnapshot().matches({
				MAIN_ACTIVITY: { TASKS: 'THINKING' }
			} as never),
			true
		)
	} finally {
		actor.stop()
	}
})

test('melee attack is reissued when the pvp controller silently loses the target', async () => {
	const bot = new FakeBot() as any
	bot.utils.getMeleeWeapon = () => ({ name: 'iron_sword' })

	const actor = createActor(
		createBotMachine({
			thinkingActor: hangingActor,
			actors: {
				serviceEntitiesTracking: noopActor,
				serviceRangedSkirmish: noopActor,
				serviceFleeing: noopActor,
				serviceEmergencyEating: hangingActor,
				serviceEmergencyHealing: hangingActor
			}
		}),
		{
			input: { bot }
		}
	)

	bot.hsm = {
		getContext: () => actor.getSnapshot().context
	}

	actor.start()

	try {
		actor.send({
			type: 'START_COMBAT',
			target: enemy as any
		})
		await waitForTurn()
		await waitForTurn()

		assert.equal(
			actor.getSnapshot().matches({
				MAIN_ACTIVITY: { COMBAT: 'MELEE_ATTACKING' }
			} as never),
			true
		)
		await waitUntil(() => bot.pvpAttackCalls > 0)
		assert.equal(bot.pvpAttackCalls > 0, true)
		assert.equal(bot.pvp.target?.id, enemy.id)

		bot.pvp.target = undefined
		await waitUntil(() => bot.pvpAttackCalls >= 2)

		assert.equal(bot.pvpAttackCalls >= 2, true)
		assert.equal(bot.pvp.target?.id, enemy.id)
	} finally {
		actor.stop()
	}
})

test('combat-to-urgent handoff force stops pvp before survival takes ownership', async () => {
	const bot = new FakeBot() as any
	bot.utils.getMeleeWeapon = () => ({ name: 'iron_sword' })
	bot.pvp.stop = async () => {
		bot.pvpStopCalls += 1
		await delay(0)
		bot.pathfinder.setGoal(null)
		bot.pvp.target = undefined
	}
	bot.pvp.forceStop = () => {
		bot.pvpForceStopCalls += 1
		bot.pvp.target = undefined
	}

	const actor = createActor(
		createBotMachine({
			thinkingActor: hangingActor,
			actors: {
				serviceEntitiesTracking: noopActor,
				serviceRangedSkirmish: noopActor,
				serviceEmergencyEating: hangingActor,
				serviceEmergencyHealing: hangingActor
			}
		}),
		{
			input: { bot }
		}
	)

	bot.hsm = {
		getContext: () => actor.getSnapshot().context
	}

	actor.start()

	try {
		actor.send({
			type: 'START_COMBAT',
			target: enemy as any
		})
		await waitForTurn()
		await waitForTurn()

		assert.equal(
			actor.getSnapshot().matches({
				MAIN_ACTIVITY: { COMBAT: 'MELEE_ATTACKING' }
			} as never),
			true
		)

		actor.send({
			type: 'UPDATE_HEALTH',
			health: 8
		})
		await waitForTurn()
		await waitForTurn()
		await delay(10)

		assert.equal(
			actor.getSnapshot().matches({
				MAIN_ACTIVITY: { URGENT_NEEDS: 'EMERGENCY_HEALING' }
			} as never),
			true
		)
		assert.equal(bot.pvpForceStopCalls > 0, true)
	} finally {
		actor.stop()
	}
})

test('emergency healing does not start eating when a live hostile is already within melee range', async () => {
	const hostileAtMeleeRange = {
		...enemy,
		id: 77,
		position: createVec3(1, 64, 0)
	}
	let eatingCalls = 0

	const bot = new FakeBot() as any
	bot.health = 8
	bot.utils = {
		...bot.utils,
		findNearestEnemy: () => hostileAtMeleeRange,
		eating: async () => {
			eatingCalls += 1
		}
	}

	const actor = createActor(
		createBotMachine({
			thinkingActor: hangingActor,
			actors: {
				serviceEntitiesTracking: noopActor,
				serviceMeleeAttack: noopActor,
				serviceRangedSkirmish: noopActor,
				serviceFleeing: noopActor
			}
		}),
		{
			input: { bot }
		}
	)

	bot.hsm = {
		getContext: () => actor.getSnapshot().context
	}

	actor.start()

	try {
		actor.send({
			type: 'UPDATE_HEALTH',
			health: 8
		})
		await waitForTurn()
		await delay(50)

		assert.equal(
			actor.getSnapshot().matches({
				MAIN_ACTIVITY: { URGENT_NEEDS: 'EMERGENCY_HEALING' }
			} as never),
			true
		)
		assert.equal(eatingCalls, 0)
	} finally {
		actor.stop()
	}
})

test('thinking execution enters a concrete executing substate without crashing', async () => {
	const thinkingActor = fromPromise(async () => ({
		kind: 'execute' as const,
		execution: {
			toolName: 'navigate_to' as const,
			args: {
				position: { x: 10, y: 64, z: 10 },
				range: 2
			}
		},
		subGoal: 'Move to target',
		transcript: ['navigate_to']
	}))

	const { actor } = (() => {
		const bot = new FakeBot() as any
		const machineActor = createActor(
			createBotMachine({
				thinkingActor,
				actors: {
					serviceEntitiesTracking: noopActor,
					serviceMeleeAttack: noopActor,
					serviceRangedSkirmish: noopActor,
					serviceFleeing: noopActor,
					serviceEmergencyEating: hangingActor,
					serviceEmergencyHealing: hangingActor
				}
			}),
			{
				input: { bot }
			}
		)

		bot.hsm = {
			getContext: () => machineActor.getSnapshot().context
		}

		machineActor.start()
		return { actor: machineActor }
	})()

	try {
		actor.send({
			type: 'USER_COMMAND',
			username: 'Steve',
			text: 'Come to me'
		})
		await waitForTurn()
		await waitForTurn()

		assert.equal(
			(actor.getSnapshot() as any).matches({
				MAIN_ACTIVITY: { TASKS: { EXECUTING: 'NAVIGATING' } }
			}),
			true
		)
	} finally {
		actor.stop()
	}
})

test('mine_resource execution routes into MINING search state', async () => {
	const thinkingActor = fromPromise(async () => ({
		kind: 'execute' as const,
		execution: {
			toolName: 'mine_resource' as any,
			args: {
				block_name: ' IRON_ORE ',
				count: 2
			}
		},
		subGoal: 'Mine iron ore',
		transcript: ['mine_resource']
	}))

	const bot = new FakeBot() as any
	bot.registry = {
		...bot.registry,
		blocksByName: {
			iron_ore: { id: 15, name: 'iron_ore' }
		}
	}

	const actor = createActor(
		createBotMachine({
			thinkingActor,
			actors: {
				serviceEntitiesTracking: noopActor,
				serviceMeleeAttack: noopActor,
				serviceRangedSkirmish: noopActor,
				serviceFleeing: noopActor,
				serviceEmergencyEating: hangingActor,
				serviceEmergencyHealing: hangingActor
			}
		}),
		{
			input: { bot }
		}
	)

	bot.hsm = {
		getContext: () => actor.getSnapshot().context
	}

	actor.start()

	try {
		actor.send({
			type: 'USER_COMMAND',
			username: 'Steve',
			text: 'Mine 2 iron ore'
		})
		await waitForTurn()
		await waitForTurn()

		assert.equal(
			(actor.getSnapshot() as any).matches({
				MAIN_ACTIVITY: {
					TASKS: { EXECUTING: { MINING: 'SEARCHING' } }
				}
			}),
			true
		)
		assert.equal(
			(actor.getSnapshot().context.taskData as any).blockName,
			'iron_ore'
		)
		assert.equal((actor.getSnapshot().context.taskData as any).count, 2)
	} finally {
		actor.stop()
	}
})

test('mine_resource records failure after repeated navigation failures', async () => {
	let thinkingCalls = 0
	const thinkingActor = fromPromise(async () => {
		thinkingCalls += 1
		if (thinkingCalls > 1) {
			return await new Promise<never>(() => {})
		}

		return {
			kind: 'execute' as const,
			execution: {
				toolName: 'mine_resource' as any,
				args: {
					block_name: 'iron_ore',
					count: 1
				}
			},
			subGoal: 'Mine iron ore',
			transcript: ['mine_resource']
		}
	})

	const bot = new FakeBot() as any
	const orePosition = createVec3(10, 64, 0)
	bot.registry = {
		...bot.registry,
		blocksByName: {
			iron_ore: { id: 15, name: 'iron_ore' }
		}
	}
	bot.findBlocks = () => [orePosition]
	bot.blockAt = (position: { x: number; y: number; z: number }) => {
		if (position.x === 10 && position.y === 64 && position.z === 0) {
			return {
				name: 'iron_ore',
				position: orePosition,
				drops: [1]
			}
		}
		if (position.x === 10 && position.y === 63 && position.z === 0) {
			return {
				name: 'stone',
				position: createVec3(10, 63, 0)
			}
		}
		return null
	}
	bot.pathfinder = {
		setGoal: (goal: unknown) => {
			if (goal) {
				setImmediate(() => bot.emit('path_stop', 'failed'))
			}
		}
	}

	const actor = createActor(
		createBotMachine({
			thinkingActor,
			actors: {
				serviceEntitiesTracking: noopActor,
				serviceMeleeAttack: noopActor,
				serviceRangedSkirmish: noopActor,
				serviceFleeing: noopActor,
				serviceEmergencyEating: hangingActor,
				serviceEmergencyHealing: hangingActor
			}
		}),
		{
			input: { bot }
		}
	)

	bot.hsm = {
		getContext: () => actor.getSnapshot().context
	}

	actor.start()

	try {
		actor.send({
			type: 'USER_COMMAND',
			username: 'Steve',
			text: 'Mine 1 iron ore'
		})

		await waitUntil(() => actor.getSnapshot().context.lastResult === 'FAILED')

		assert.equal(actor.getSnapshot().context.lastAction, 'mine_resource')
		assert.equal(actor.getSnapshot().context.lastResult, 'FAILED')
		assert.equal(actor.getSnapshot().context.pendingExecution, null)
		assert.equal(actor.getSnapshot().context.taskData, null)
	} finally {
		actor.stop()
	}
})

test('mine_resource records failure after repeated breaking failures', async () => {
	let thinkingCalls = 0
	const thinkingActor = fromPromise(async () => {
		thinkingCalls += 1
		if (thinkingCalls > 1) {
			return await new Promise<never>(() => {})
		}

		return {
			kind: 'execute' as const,
			execution: {
				toolName: 'mine_resource' as any,
				args: {
					block_name: 'iron_ore',
					count: 1
				}
			},
			subGoal: 'Mine iron ore',
			transcript: ['mine_resource']
		}
	})

	const bot = new FakeBot() as any
	const orePosition = createVec3(1, 64, 0)
	bot.registry = {
		...bot.registry,
		blocksByName: {
			iron_ore: { id: 15, name: 'iron_ore' }
		}
	}
	bot.findBlocks = () => [orePosition]
	bot.blockAt = (position: { x: number; y: number; z: number }) => {
		if (position.x === 1 && position.y === 64 && position.z === 0) {
			return {
				name: 'iron_ore',
				position: orePosition,
				drops: [1]
			}
		}
		if (position.x === 1 && position.y === 63 && position.z === 0) {
			return {
				name: 'stone',
				position: createVec3(1, 63, 0)
			}
		}
		return null
	}
	bot.tool = {
		equipForBlock: async () => {
			throw new Error('no harvest tool')
		}
	}

	const actor = createActor(
		createBotMachine({
			thinkingActor,
			actors: {
				serviceEntitiesTracking: noopActor,
				serviceMeleeAttack: noopActor,
				serviceRangedSkirmish: noopActor,
				serviceFleeing: noopActor,
				serviceEmergencyEating: hangingActor,
				serviceEmergencyHealing: hangingActor
			}
		}),
		{
			input: { bot }
		}
	)

	bot.hsm = {
		getContext: () => actor.getSnapshot().context
	}

	actor.start()

	try {
		actor.send({
			type: 'USER_COMMAND',
			username: 'Steve',
			text: 'Mine 1 iron ore'
		})

		await waitUntil(() => actor.getSnapshot().context.lastResult === 'FAILED')

		assert.equal(actor.getSnapshot().context.lastAction, 'mine_resource')
		assert.equal(actor.getSnapshot().context.lastResult, 'FAILED')
		assert.equal(actor.getSnapshot().context.pendingExecution, null)
		assert.equal(actor.getSnapshot().context.taskData, null)
	} finally {
		actor.stop()
	}
})

test('follow_entity runtime selector requires entity_name and entity_type to match the same entity', async () => {
	const thinkingActor = fromPromise(async () => ({
		kind: 'execute' as const,
		execution: {
			toolName: 'follow_entity' as const,
			args: {
				entity_name: 'Steve',
				entity_type: 'player',
				distance: 2,
				max_distance: 32
			}
		},
		subGoal: 'Follow Steve',
		transcript: ['follow_entity']
	}))

	const bot = new FakeBot() as any
	const selectedEntityIds: number[] = []
	const candidateEntities = [
		{
			id: 1,
			username: 'Steve',
			name: 'steve_skin',
			type: 'cow',
			position: createVec3(2, 64, 0),
			height: 1.8
		},
		{
			id: 2,
			username: 'Alex',
			name: 'alex',
			type: 'player',
			position: createVec3(3, 64, 0),
			height: 1.8
		},
		{
			id: 3,
			username: 'Steve',
			name: 'Steve',
			type: 'player',
			position: createVec3(4, 64, 0),
			height: 1.8
		}
	]

	bot.entities = Object.fromEntries(
		candidateEntities.map(entity => [String(entity.id), entity])
	)
	bot.nearestEntity = (predicate: (entity: any) => boolean) => {
		const target = candidateEntities.find(entity => predicate(entity)) ?? null
		selectedEntityIds.push(target?.id ?? -1)
		return target
	}

	const actor = createActor(
		createBotMachine({
			thinkingActor,
			actors: {
				serviceEntitiesTracking: noopActor,
				serviceMeleeAttack: noopActor,
				serviceRangedSkirmish: noopActor,
				serviceFleeing: noopActor,
				serviceEmergencyEating: hangingActor,
				serviceEmergencyHealing: hangingActor
			}
		}),
		{
			input: { bot }
		}
	)

	bot.hsm = {
		getContext: () => actor.getSnapshot().context
	}

	actor.start()

	try {
		actor.send({
			type: 'USER_COMMAND',
			username: 'Steve',
			text: 'Follow Steve'
		})
		await waitForTurn()
		await waitForTurn()

		assert.equal(selectedEntityIds.length > 0, true)
		assert.equal(selectedEntityIds[0], 3)
		assert.equal(
			(actor.getSnapshot() as any).matches({
				MAIN_ACTIVITY: { TASKS: { EXECUTING: 'FOLLOWING' } }
			}),
			true
		)
	} finally {
		actor.stop()
	}
})

test('open_window, transfer_item, and close_window route through the HSM with session lifecycle', async () => {
	let thinkingCalls = 0
	let openCalls = 0
	let transferCalls = 0
	let closeCalls = 0
	let transferredArgs: any = null

	const thinkingActor = fromPromise(async () => {
		thinkingCalls += 1

		if (thinkingCalls === 1) {
			return {
				kind: 'execute' as const,
				execution: {
					toolName: 'open_window' as const,
					args: {
						position: { x: 1, y: 64, z: 1 }
					}
				},
				subGoal: 'Open the window',
				transcript: ['open_window']
			}
		}

		if (thinkingCalls === 2) {
			return {
				kind: 'execute' as const,
				execution: {
					toolName: 'transfer_item' as const,
					args: {
						source_zone: 'player_inventory',
						dest_zone: 'input',
						item_name: 'iron_ore',
						count: 1
					}
				},
				subGoal: 'Move the ore',
				transcript: ['transfer_item']
			}
		}

		if (thinkingCalls === 3) {
			return {
				kind: 'execute' as const,
				execution: {
					toolName: 'close_window' as const,
					args: {}
				},
				subGoal: 'Close the window',
				transcript: ['close_window']
			}
		}

		return await new Promise<never>(() => {})
	})

	const bot = new FakeBot() as any
	bot.blockAt = (position: { x: number; y: number; z: number }) =>
		position.x === 1 && position.y === 64 && position.z === 1
			? {
					name: 'furnace',
					position: createVec3(1, 64, 1)
				}
			: null
	bot.openFurnace = async () =>
		trackWindow(
			bot,
			await (async () => {
				openCalls += 1
				return {
					slots: Array.from({ length: 46 }, (_, index) =>
						index === 10
							? {
									name: 'iron_ore',
									count: 3,
									type: 1,
									metadata: 0
								}
							: null
					),
					close: () => {
						closeCalls += 1
					},
					containerItems() {
						return []
					},
					findItemRangeName(
						this: {
							slots: Array<{
								name: string
								type: number
								metadata: number
							} | null>
						},
						start: number,
						end: number,
						itemName: string
					): { type: number; metadata: number | null } | null {
						for (let index = start; index < end; index += 1) {
							const slot = this.slots[index]
							if (slot?.name === itemName) {
								return {
									type: slot.type ?? 1,
									metadata: slot.metadata ?? null
								}
							}
						}

						return null
					}
				}
			})()
		)
	bot.transfer = async (params: unknown) => {
		transferCalls += 1
		transferredArgs = params
	}

	const actor = createActor(
		createBotMachine({
			thinkingActor,
			actors: {
				serviceEntitiesTracking: noopActor,
				serviceMeleeAttack: noopActor,
				serviceRangedSkirmish: noopActor,
				serviceFleeing: noopActor,
				serviceEmergencyEating: hangingActor,
				serviceEmergencyHealing: hangingActor
			}
		}),
		{
			input: { bot }
		}
	)

	bot.hsm = {
		getContext: () => actor.getSnapshot().context
	}

	actor.start()

	try {
		actor.send({
			type: 'USER_COMMAND',
			username: 'Steve',
			text: 'Organize the furnace'
		})

		await waitForTurn()
		await waitForTurn()
		await waitForTurn()
		await waitForTurn()
		await waitForTurn()
		await waitForTurn()

		assert.equal(openCalls, 1)
		assert.equal(transferCalls, 1)
		assert.equal(closeCalls, 1)
		assert.equal(
			(actor.getSnapshot().context as any).windows!.getSnapshot().session,
			null
		)
		assert.equal((transferredArgs as any)?.itemType, 1)
		assert.equal((transferredArgs as any)?.sourceStart, 3)
		assert.equal((transferredArgs as any)?.destStart, 0)
		assert.equal((transferredArgs as any)?.count, 1)
		assert.equal((transferredArgs as any)?.sourceEnd, 37)
		assert.equal((transferredArgs as any)?.destEnd, 1)
		assert.equal(
			(actor.getSnapshot() as any).matches({
				MAIN_ACTIVITY: { TASKS: 'THINKING' }
			}),
			true
		)
	} finally {
		actor.stop()
	}
})

test('START_COMBAT closes an active window before entering combat', async () => {
	let openCalls = 0
	let closeCalls = 0

	const thinkingActor = fromPromise(async () => {
		return {
			kind: 'execute' as const,
			execution: {
				toolName: 'open_window' as const,
				args: {
					position: { x: 1, y: 64, z: 1 }
				}
			},
			subGoal: 'Open the window',
			transcript: ['open_window']
		}
	})

	const bot = new FakeBot() as any
	bot.blockAt = (position: { x: number; y: number; z: number }) =>
		position.x === 1 && position.y === 64 && position.z === 1
			? {
					name: 'furnace',
					position: createVec3(1, 64, 1)
				}
			: null
	bot.openFurnace = async () =>
		trackWindow(
			bot,
			await (async () => {
				openCalls += 1
				return {
					slots: Array.from({ length: 46 }, () => null),
					close: () => {
						closeCalls += 1
					},
					containerItems() {
						return []
					},
					findItemRangeName() {
						return null
					}
				}
			})()
		)

	const actor = createActor(
		createBotMachine({
			thinkingActor,
			actors: {
				serviceEntitiesTracking: noopActor,
				serviceMeleeAttack: noopActor,
				serviceRangedSkirmish: noopActor,
				serviceFleeing: noopActor,
				serviceEmergencyEating: hangingActor,
				serviceEmergencyHealing: hangingActor
			}
		}),
		{
			input: { bot }
		}
	)

	bot.hsm = {
		getContext: () => actor.getSnapshot().context
	}

	actor.start()

	try {
		actor.send({
			type: 'USER_COMMAND',
			username: 'Steve',
			text: 'Open the window'
		})

		await waitForTurn()
		await waitForTurn()

		actor.send({ type: 'START_COMBAT', target: enemy as any })
		await waitForTurn()
		await waitForTurn()

		assert.equal(openCalls, 1)
		assert.equal(closeCalls, 1)
		assert.equal(
			(actor.getSnapshot().context as any).windows!.getSnapshot().session,
			null
		)
		assert.equal(
			(actor.getSnapshot().context as any).preferredCombatTargetId,
			enemy.id
		)
	} finally {
		actor.stop()
	}
})

test('UPDATE_ENTITIES closes an active window before auto-combat preemption', async () => {
	let openCalls = 0
	let closeCalls = 0

	const thinkingActor = fromPromise(async () => {
		return {
			kind: 'execute' as const,
			execution: {
				toolName: 'open_window' as const,
				args: {
					position: { x: 1, y: 64, z: 1 }
				}
			},
			subGoal: 'Open the window',
			transcript: ['open_window']
		}
	})

	const bot = new FakeBot() as any
	bot.blockAt = (position: { x: number; y: number; z: number }) =>
		position.x === 1 && position.y === 64 && position.z === 1
			? {
					name: 'furnace',
					position: createVec3(1, 64, 1)
				}
			: null
	bot.openFurnace = async () =>
		trackWindow(
			bot,
			await (async () => {
				openCalls += 1
				return {
					slots: Array.from({ length: 46 }, () => null),
					close: () => {
						closeCalls += 1
					},
					containerItems() {
						return []
					},
					findItemRangeName() {
						return null
					}
				}
			})()
		)

	const actor = createActor(
		createBotMachine({
			thinkingActor,
			actors: {
				serviceEntitiesTracking: noopActor,
				serviceMeleeAttack: noopActor,
				serviceRangedSkirmish: noopActor,
				serviceFleeing: noopActor,
				serviceEmergencyEating: hangingActor,
				serviceEmergencyHealing: hangingActor
			}
		}),
		{
			input: { bot }
		}
	)

	bot.hsm = {
		getContext: () => actor.getSnapshot().context
	}

	actor.start()

	try {
		actor.send({
			type: 'USER_COMMAND',
			username: 'Steve',
			text: 'Open the window'
		})

		await waitForTurn()
		await waitForTurn()

		publishEntities(actor, {
			type: 'UPDATE_ENTITIES',
			entities: [enemy as any],
			enemies: [enemy as any],
			players: [],
			combatTarget: { entity: enemy as any, distance: 2 }
		})
		await waitForTurn()
		await waitForTurn()

		assert.equal(openCalls, 1)
		assert.equal(closeCalls, 1)
		assert.equal(
			(actor.getSnapshot().context as any).windows!.getSnapshot().session,
			null
		)
		assert.equal(
			(actor.getSnapshot().context as any).preferredCombatTargetId,
			enemy.id
		)
	} finally {
		actor.stop()
	}
})

test('START_URGENT_NEEDS closes an active window before urgent handling', async () => {
	let openCalls = 0
	let closeCalls = 0

	const thinkingActor = fromPromise(async () => {
		return {
			kind: 'execute' as const,
			execution: {
				toolName: 'open_window' as const,
				args: {
					position: { x: 1, y: 64, z: 1 }
				}
			},
			subGoal: 'Open the window',
			transcript: ['open_window']
		}
	})

	const bot = new FakeBot() as any
	bot.blockAt = (position: { x: number; y: number; z: number }) =>
		position.x === 1 && position.y === 64 && position.z === 1
			? {
					name: 'furnace',
					position: createVec3(1, 64, 1)
				}
			: null
	bot.openFurnace = async () =>
		trackWindow(
			bot,
			await (async () => {
				openCalls += 1
				return {
					slots: Array.from({ length: 46 }, () => null),
					close: () => {
						closeCalls += 1
					},
					containerItems() {
						return []
					},
					findItemRangeName() {
						return null
					}
				}
			})()
		)

	const actor = createActor(
		createBotMachine({
			thinkingActor,
			actors: {
				serviceEntitiesTracking: noopActor,
				serviceMeleeAttack: noopActor,
				serviceRangedSkirmish: noopActor,
				serviceFleeing: noopActor,
				serviceEmergencyEating: hangingActor,
				serviceEmergencyHealing: hangingActor
			}
		}),
		{
			input: { bot }
		}
	)

	bot.hsm = {
		getContext: () => actor.getSnapshot().context
	}

	actor.start()

	try {
		actor.send({
			type: 'USER_COMMAND',
			username: 'Steve',
			text: 'Open the window'
		})

		await waitForTurn()
		await waitForTurn()

		actor.send({
			type: 'UPDATE_ENTITIES',
			entities: [],
			enemies: [],
			players: []
		})
		actor.send({ type: 'START_URGENT_NEEDS', need: 'food' })
		await waitForTurn()
		await waitForTurn()

		assert.equal(openCalls, 1)
		assert.equal(closeCalls, 1)
		assert.equal(
			(actor.getSnapshot().context as any).windows!.getSnapshot().session,
			null
		)
		assert.equal(
			(actor.getSnapshot() as any).matches({
				MAIN_ACTIVITY: { URGENT_NEEDS: 'EMERGENCY_EATING' }
			}),
			true
		)
	} finally {
		actor.stop()
	}
})

test('failed window close marks the session retryable until a confirmed close succeeds', async () => {
	let thinkingCalls = 0
	let openCalls = 0
	let closeCalls = 0
	let releaseRetry: () => void = () => {}
	const retryGate = new Promise<void>(resolve => {
		releaseRetry = resolve
	})

	const thinkingActor = fromPromise(async () => {
		thinkingCalls += 1

		if (thinkingCalls === 1) {
			return {
				kind: 'execute' as const,
				execution: {
					toolName: 'open_window' as const,
					args: {
						position: { x: 1, y: 64, z: 1 }
					}
				},
				subGoal: 'Open the window',
				transcript: ['open_window']
			}
		}

		if (thinkingCalls === 2) {
			return {
				kind: 'execute' as const,
				execution: {
					toolName: 'close_window' as const,
					args: {}
				},
				subGoal: 'Close the window',
				transcript: ['close_window']
			}
		}

		if (thinkingCalls === 3) {
			await retryGate
			return {
				kind: 'execute' as const,
				execution: {
					toolName: 'close_window' as const,
					args: {}
				},
				subGoal: 'Retry the close',
				transcript: ['close_window']
			}
		}

		if (thinkingCalls === 4) {
			return {
				kind: 'execute' as const,
				execution: {
					toolName: 'open_window' as const,
					args: {
						position: { x: 1, y: 64, z: 1 }
					}
				},
				subGoal: 'Reopen the window',
				transcript: ['open_window']
			}
		}

		return await new Promise<never>(() => {})
	})

	const bot = new FakeBot() as any
	bot.blockAt = (position: { x: number; y: number; z: number }) =>
		position.x === 1 && position.y === 64 && position.z === 1
			? {
					name: 'furnace',
					position: createVec3(1, 64, 1)
				}
			: null
	bot.openFurnace = async () =>
		trackWindow(
			bot,
			await (async () => {
				openCalls += 1
				return {
					slots: Array.from({ length: 46 }, () => null),
					close: () => {
						closeCalls += 1
						if (closeCalls === 1) {
							throw new Error('close failed')
						}
					},
					containerItems() {
						return []
					},
					findItemRangeName() {
						return null
					}
				}
			})()
		)

	const actor = createActor(
		createBotMachine({
			thinkingActor,
			actors: {
				serviceEntitiesTracking: noopActor,
				serviceMeleeAttack: noopActor,
				serviceRangedSkirmish: noopActor,
				serviceFleeing: noopActor,
				serviceEmergencyEating: hangingActor,
				serviceEmergencyHealing: hangingActor
			}
		}),
		{
			input: { bot }
		}
	)

	bot.hsm = {
		getContext: () => actor.getSnapshot().context
	}

	actor.start()

	try {
		actor.send({
			type: 'USER_COMMAND',
			username: 'Steve',
			text: 'Retry the window'
		})

		for (let i = 0; i < 6; i += 1) {
			await waitForTurn()
			if (closeCalls === 1 && thinkingCalls >= 3) {
				break
			}
		}

		assert.equal(openCalls, 1)
		assert.equal(closeCalls, 1)
		assert.equal(
			(actor.getSnapshot().context as any).windows!.getSnapshot().state,
			'close_failed'
		)
		assert.equal(
			(actor.getSnapshot().context as any).windows!.getSnapshot().session !==
				null,
			true
		)

		releaseRetry()
		await waitForTurn()
		await waitForTurn()
		await waitForTurn()
		await waitForTurn()

		assert.equal(openCalls, 2)
		assert.equal(closeCalls, 2)
		assert.equal(
			(actor.getSnapshot().context as any).windows!.getSnapshot().state,
			'open'
		)
		assert.equal(
			(actor.getSnapshot().context as any).windows!.getSnapshot().session !==
				null,
			true
		)
	} finally {
		actor.stop()
	}
})

test('transfer_item is rejected while the window close is unconfirmed', async () => {
	let thinkingCalls = 0
	let openCalls = 0
	let closeCalls = 0
	let transferCalls = 0

	const thinkingActor = fromPromise(async () => {
		thinkingCalls += 1

		if (thinkingCalls === 1) {
			return {
				kind: 'execute' as const,
				execution: {
					toolName: 'open_window' as const,
					args: {
						position: { x: 1, y: 64, z: 1 }
					}
				},
				subGoal: 'Open the window',
				transcript: ['open_window']
			}
		}

		if (thinkingCalls === 2) {
			return {
				kind: 'execute' as const,
				execution: {
					toolName: 'close_window' as const,
					args: {}
				},
				subGoal: 'Close the window',
				transcript: ['close_window']
			}
		}

		if (thinkingCalls === 3) {
			return {
				kind: 'execute' as const,
				execution: {
					toolName: 'transfer_item' as const,
					args: {
						source_zone: 'player_inventory',
						dest_zone: 'input',
						item_name: 'iron_ore',
						count: 1
					}
				},
				subGoal: 'Try to move ore',
				transcript: ['transfer_item']
			}
		}

		return await new Promise<never>(() => {})
	})

	const bot = new FakeBot() as any
	bot.blockAt = (position: { x: number; y: number; z: number }) =>
		position.x === 1 && position.y === 64 && position.z === 1
			? {
					name: 'furnace',
					position: createVec3(1, 64, 1)
				}
			: null
	bot.openFurnace = async () =>
		trackWindow(
			bot,
			await (async () => {
				openCalls += 1
				return {
					slots: Array.from({ length: 46 }, () => null),
					close: () => {
						closeCalls += 1
						if (closeCalls === 1) {
							throw new Error('close failed')
						}
					},
					containerItems() {
						return []
					},
					findItemRangeName() {
						return null
					}
				}
			})()
		)
	bot.transfer = async () => {
		transferCalls += 1
	}

	const actor = createActor(
		createBotMachine({
			thinkingActor,
			actors: {
				serviceEntitiesTracking: noopActor,
				serviceMeleeAttack: noopActor,
				serviceRangedSkirmish: noopActor,
				serviceFleeing: noopActor,
				serviceEmergencyEating: hangingActor,
				serviceEmergencyHealing: hangingActor
			}
		}),
		{
			input: { bot }
		}
	)

	bot.hsm = {
		getContext: () => actor.getSnapshot().context
	}

	actor.start()

	try {
		actor.send({
			type: 'USER_COMMAND',
			username: 'Steve',
			text: 'Retry the window'
		})

		for (let i = 0; i < 8; i += 1) {
			await waitForTurn()
			if (thinkingCalls >= 3) {
				break
			}
		}

		assert.equal(openCalls, 1)
		assert.equal(closeCalls, 1)
		assert.equal(transferCalls, 0)
		assert.equal(
			(actor.getSnapshot().context as any).windows!.getSnapshot().state,
			'close_failed'
		)
	} finally {
		actor.stop()
	}
})

test('open_window abort after open preserves the session when close fails', async () => {
	let thinkingCalls = 0
	let openCalls = 0
	let closeCalls = 0

	const thinkingActor = fromPromise(async () => {
		thinkingCalls += 1
		if (thinkingCalls === 1) {
			return {
				kind: 'execute' as const,
				execution: {
					toolName: 'open_window' as const,
					args: {
						position: { x: 1, y: 64, z: 1 }
					}
				},
				subGoal: 'Open the window',
				transcript: ['open_window']
			}
		}

		return await new Promise<never>(() => {})
	})

	const bot = new FakeBot() as any
	bot.blockAt = (position: { x: number; y: number; z: number }) =>
		position.x === 1 && position.y === 64 && position.z === 1
			? {
					name: 'furnace',
					position: createVec3(1, 64, 1)
				}
			: null
	bot.openFurnace = async () =>
		trackWindow(
			bot,
			await (async () => {
				openCalls += 1
				return await new Promise(resolve => {
					setImmediate(() => {
						process.nextTick(() => {
							actor.send({
								type: 'START_COMBAT',
								target: enemy as any
							})
						})
						resolve({
							slots: Array.from({ length: 46 }, () => null),
							close: () => {
								closeCalls += 1
								throw new Error('close failed')
							},
							containerItems() {
								return []
							},
							findItemRangeName() {
								return null
							}
						})
					})
				})
			})()
		)

	const actor = createActor(
		createBotMachine({
			thinkingActor,
			actors: {
				serviceEntitiesTracking: noopActor,
				serviceMeleeAttack: noopActor,
				serviceRangedSkirmish: noopActor,
				serviceFleeing: noopActor,
				serviceEmergencyEating: hangingActor,
				serviceEmergencyHealing: hangingActor
			}
		}),
		{
			input: { bot }
		}
	)

	bot.hsm = {
		getContext: () => actor.getSnapshot().context,
		send: (event: any) => actor.send(event)
	}
	actor.start()

	try {
		actor.send({
			type: 'USER_COMMAND',
			username: 'Steve',
			text: 'Open the window'
		})

		await waitForTurn()
		await waitForTurn()
		await waitForTurn()

		assert.equal(openCalls, 1)
		assert.equal(closeCalls, 1)
		assert.equal(
			(actor.getSnapshot().context as any).windows!.getSnapshot().session !==
				null,
			true
		)
		assert.equal(
			(actor.getSnapshot().context as any).windows!.getSnapshot().state,
			'close_failed'
		)
		assert.equal((actor.getSnapshot().context as any).lastResult, null)
	} finally {
		actor.stop()
	}
})

test('DEATH clears active window session state and closes any open window', async () => {
	let openCalls = 0
	let closeCalls = 0

	let thinkingCalls = 0
	const thinkingActor = fromPromise(async () => {
		thinkingCalls += 1
		if (thinkingCalls === 1) {
			return {
				kind: 'execute' as const,
				execution: {
					toolName: 'open_window' as const,
					args: {
						position: { x: 1, y: 64, z: 1 }
					}
				},
				subGoal: 'Open the window',
				transcript: ['open_window']
			}
		}

		return await new Promise<never>(() => {})
	})

	const bot = new FakeBot() as any
	bot.blockAt = (position: { x: number; y: number; z: number }) =>
		position.x === 1 && position.y === 64 && position.z === 1
			? {
					name: 'furnace',
					position: createVec3(1, 64, 1)
				}
			: null
	bot.openFurnace = async () =>
		trackWindow(
			bot,
			await (async () => {
				openCalls += 1
				return {
					slots: Array.from({ length: 46 }, () => null),
					close: () => {
						closeCalls += 1
					},
					containerItems() {
						return []
					},
					findItemRangeName() {
						return null
					}
				}
			})()
		)

	const actor = createActor(
		createBotMachine({
			thinkingActor,
			actors: {
				serviceEntitiesTracking: noopActor,
				serviceMeleeAttack: noopActor,
				serviceRangedSkirmish: noopActor,
				serviceFleeing: noopActor,
				serviceEmergencyEating: hangingActor,
				serviceEmergencyHealing: hangingActor
			}
		}),
		{
			input: { bot }
		}
	)

	bot.hsm = {
		getContext: () => actor.getSnapshot().context
	}

	actor.start()

	try {
		actor.send({
			type: 'USER_COMMAND',
			username: 'Steve',
			text: 'Open the window'
		})

		await waitForTurn()
		await waitForTurn()

		actor.send({ type: 'DEATH' })
		await waitForTurn()

		assert.equal(openCalls, 1)
		assert.equal(closeCalls, 1)
		assert.equal(
			(actor.getSnapshot().context as any).windows!.getSnapshot().session,
			null
		)
		assert.equal(
			(actor.getSnapshot().context as any).windows!.getSnapshot().state,
			null
		)
	} finally {
		actor.stop()
	}
})

test('STOP_CURRENT_GOAL clears active window session state and closes any open window', async () => {
	let openCalls = 0
	let closeCalls = 0

	let thinkingCalls = 0
	const thinkingActor = fromPromise(async () => {
		thinkingCalls += 1
		if (thinkingCalls === 1) {
			return {
				kind: 'execute' as const,
				execution: {
					toolName: 'open_window' as const,
					args: {
						position: { x: 1, y: 64, z: 1 }
					}
				},
				subGoal: 'Open the window',
				transcript: ['open_window']
			}
		}

		return await new Promise<never>(() => {})
	})

	const bot = new FakeBot() as any
	bot.blockAt = (position: { x: number; y: number; z: number }) =>
		position.x === 1 && position.y === 64 && position.z === 1
			? {
					name: 'furnace',
					position: createVec3(1, 64, 1)
				}
			: null
	bot.openFurnace = async () =>
		trackWindow(
			bot,
			await (async () => {
				openCalls += 1
				return {
					slots: Array.from({ length: 46 }, () => null),
					close: () => {
						closeCalls += 1
					},
					containerItems() {
						return []
					},
					findItemRangeName() {
						return null
					}
				}
			})()
		)

	const actor = createActor(
		createBotMachine({
			thinkingActor,
			actors: {
				serviceEntitiesTracking: noopActor,
				serviceMeleeAttack: noopActor,
				serviceRangedSkirmish: noopActor,
				serviceFleeing: noopActor,
				serviceEmergencyEating: hangingActor,
				serviceEmergencyHealing: hangingActor
			}
		}),
		{
			input: { bot }
		}
	)

	bot.hsm = {
		getContext: () => actor.getSnapshot().context
	}

	actor.start()

	try {
		actor.send({
			type: 'USER_COMMAND',
			username: 'Steve',
			text: 'Open the window'
		})

		await waitForTurn()
		await waitForTurn()

		actor.send({ type: 'STOP_CURRENT_GOAL' })
		await waitForTurn()

		assert.equal(openCalls, 1)
		assert.equal(closeCalls, 1)
		assert.equal(
			(actor.getSnapshot().context as any).windows!.getSnapshot().session,
			null
		)
		assert.equal(
			(actor.getSnapshot().context as any).windows!.getSnapshot().state,
			null
		)
		assert.equal(
			actor.getSnapshot().matches({ MAIN_ACTIVITY: 'IDLE' } as never),
			true
		)
	} finally {
		actor.stop()
	}
})

test('thinking finish clears active window session state and closes any open window', async () => {
	let thinkingCalls = 0
	let openCalls = 0
	let closeCalls = 0

	const thinkingActor = fromPromise(async () => {
		thinkingCalls += 1
		if (thinkingCalls === 1) {
			return {
				kind: 'execute' as const,
				execution: {
					toolName: 'open_window' as const,
					args: {
						position: { x: 1, y: 64, z: 1 }
					}
				},
				subGoal: 'Open the window',
				transcript: ['open_window']
			}
		}

		if (thinkingCalls === 2) {
			return {
				kind: 'finish' as const,
				message: 'Finished',
				transcript: ['finish_goal']
			}
		}

		return await new Promise<never>(() => {})
	})

	const bot = new FakeBot() as any
	bot.blockAt = (position: { x: number; y: number; z: number }) =>
		position.x === 1 && position.y === 64 && position.z === 1
			? {
					name: 'furnace',
					position: createVec3(1, 64, 1)
				}
			: null
	bot.openFurnace = async () =>
		trackWindow(
			bot,
			await (async () => {
				openCalls += 1
				return {
					slots: Array.from({ length: 46 }, () => null),
					close: () => {
						closeCalls += 1
					},
					containerItems() {
						return []
					},
					findItemRangeName() {
						return null
					}
				}
			})()
		)

	const actor = createActor(
		createBotMachine({
			thinkingActor,
			actors: {
				serviceEntitiesTracking: noopActor,
				serviceMeleeAttack: noopActor,
				serviceRangedSkirmish: noopActor,
				serviceFleeing: noopActor,
				serviceEmergencyEating: hangingActor,
				serviceEmergencyHealing: hangingActor
			}
		}),
		{
			input: { bot }
		}
	)

	bot.hsm = {
		getContext: () => actor.getSnapshot().context
	}

	actor.start()

	try {
		actor.send({
			type: 'USER_COMMAND',
			username: 'Steve',
			text: 'Open then finish'
		})

		await waitForTurn()
		await waitForTurn()
		await waitForTurn()
		await waitForTurn()

		assert.equal(openCalls, 1)
		assert.equal(closeCalls, 1)
		assert.equal(
			(actor.getSnapshot().context as any).windows!.getSnapshot().session,
			null
		)
		assert.equal(
			(actor.getSnapshot().context as any).windows!.getSnapshot().state,
			null
		)
		assert.equal(
			actor.getSnapshot().matches({ MAIN_ACTIVITY: 'IDLE' } as never),
			true
		)
	} finally {
		actor.stop()
	}
})

test('thinking failure clears active window session state and closes any open window', async () => {
	let thinkingCalls = 0
	let openCalls = 0
	let closeCalls = 0

	const thinkingActor = fromPromise(async () => {
		thinkingCalls += 1
		if (thinkingCalls === 1) {
			return {
				kind: 'execute' as const,
				execution: {
					toolName: 'open_window' as const,
					args: {
						position: { x: 1, y: 64, z: 1 }
					}
				},
				subGoal: 'Open the window',
				transcript: ['open_window']
			}
		}

		if (thinkingCalls === 2) {
			return {
				kind: 'failed' as const,
				reason: 'Cannot proceed',
				transcript: ['failure']
			}
		}

		return await new Promise<never>(() => {})
	})

	const bot = new FakeBot() as any
	bot.blockAt = (position: { x: number; y: number; z: number }) =>
		position.x === 1 && position.y === 64 && position.z === 1
			? {
					name: 'furnace',
					position: createVec3(1, 64, 1)
				}
			: null
	bot.openFurnace = async () =>
		trackWindow(
			bot,
			await (async () => {
				openCalls += 1
				return {
					slots: Array.from({ length: 46 }, () => null),
					close: () => {
						closeCalls += 1
					},
					containerItems() {
						return []
					},
					findItemRangeName() {
						return null
					}
				}
			})()
		)

	const actor = createActor(
		createBotMachine({
			thinkingActor,
			actors: {
				serviceEntitiesTracking: noopActor,
				serviceMeleeAttack: noopActor,
				serviceRangedSkirmish: noopActor,
				serviceFleeing: noopActor,
				serviceEmergencyEating: hangingActor,
				serviceEmergencyHealing: hangingActor
			}
		}),
		{
			input: { bot }
		}
	)

	bot.hsm = {
		getContext: () => actor.getSnapshot().context
	}

	actor.start()

	try {
		actor.send({
			type: 'USER_COMMAND',
			username: 'Steve',
			text: 'Open then fail'
		})

		await waitForTurn()
		await waitForTurn()
		await waitForTurn()
		await waitForTurn()

		assert.equal(openCalls, 1)
		assert.equal(closeCalls, 1)
		assert.equal(
			(actor.getSnapshot().context as any).windows!.getSnapshot().session,
			null
		)
		assert.equal(
			(actor.getSnapshot().context as any).windows!.getSnapshot().state,
			null
		)
		assert.equal(
			actor.getSnapshot().matches({ MAIN_ACTIVITY: 'IDLE' } as never),
			true
		)
	} finally {
		actor.stop()
	}
})

test('invalid navigate args do not default to world zero', async () => {
	let thinkingCalls = 0
	const setGoalCalls: unknown[] = []
	const thinkingActor = fromPromise(async () => {
		thinkingCalls += 1
		if (thinkingCalls === 1) {
			return {
				kind: 'execute' as const,
				execution: {
					toolName: 'navigate_to' as const,
					args: {}
				},
				subGoal: 'Move to target',
				transcript: ['navigate_to']
			}
		}

		return await new Promise<never>(() => {})
	})

	const bot = new FakeBot() as any
	bot.pathfinder = {
		setGoal: (goal: unknown) => {
			setGoalCalls.push(goal)
		}
	}

	const actor = createActor(
		createBotMachine({
			thinkingActor,
			actors: {
				serviceEntitiesTracking: noopActor,
				serviceMeleeAttack: noopActor,
				serviceRangedSkirmish: noopActor,
				serviceFleeing: noopActor,
				serviceEmergencyEating: hangingActor,
				serviceEmergencyHealing: hangingActor
			}
		}),
		{
			input: { bot }
		}
	)

	bot.hsm = {
		getContext: () => actor.getSnapshot().context
	}

	actor.start()

	try {
		actor.send({
			type: 'USER_COMMAND',
			username: 'Steve',
			text: 'Come to me'
		})
		await waitForTurn()
		await waitForTurn()
		await waitForTurn()

		const nonNullGoalCalls = setGoalCalls.filter(Boolean)
		assert.equal(nonNullGoalCalls.length, 0)
		assert.equal(
			(actor.getSnapshot() as any).matches({
				MAIN_ACTIVITY: { TASKS: 'THINKING' }
			}),
			true
		)
	} finally {
		actor.stop()
	}
})

test('conversation history survives completed goals and is appended on user and assistant turns', async () => {
	let thinkingCalls = 0
	const thinkingActor = fromPromise(async () => {
		thinkingCalls += 1

		if (thinkingCalls === 1) {
			return {
				kind: 'finish' as const,
				message: 'Я буду отвечать по-русски.',
				transcript: ['finish_goal']
			}
		}

		return await new Promise<never>(() => {})
	})

	const bot = new FakeBot() as any
	const actor = createActor(
		createBotMachine({
			thinkingActor,
			actors: {
				serviceEntitiesTracking: noopActor,
				serviceMeleeAttack: noopActor,
				serviceRangedSkirmish: noopActor,
				serviceFleeing: noopActor,
				serviceEmergencyEating: hangingActor,
				serviceEmergencyHealing: hangingActor
			}
		}),
		{
			input: { bot }
		}
	)

	bot.hsm = {
		getContext: () => actor.getSnapshot().context
	}

	actor.start()

	try {
		actor.send({
			type: 'USER_COMMAND',
			username: 'Smidvard',
			text: 'отвечай по-русски'
		})

		await waitForTurn()
		await waitForTurn()

		assert.deepEqual(actor.getSnapshot().context.conversationHistory, [
			{
				role: 'user',
				username: 'Smidvard',
				message: 'отвечай по-русски'
			},
			{
				role: 'assistant',
				message: 'Я буду отвечать по-русски.'
			}
		])
		assert.equal(actor.getSnapshot().context.currentGoal, null)

		actor.send({
			type: 'USER_COMMAND',
			username: 'Smidvard',
			text: 'что у тебя в инвентаре?'
		})
		await waitForTurn()

		assert.deepEqual(actor.getSnapshot().context.conversationHistory, [
			{
				role: 'user',
				username: 'Smidvard',
				message: 'отвечай по-русски'
			},
			{
				role: 'assistant',
				message: 'Я буду отвечать по-русски.'
			},
			{
				role: 'user',
				username: 'Smidvard',
				message: 'что у тебя в инвентаре?'
			}
		])
	} finally {
		actor.stop()
	}
})

test('mixed terminal and inline responses are rejected before inline side effects in either order', async () => {
	for (const terminal of ['mine_resource', 'finish_goal']) {
		for (const reverse of [false, true]) {
			const fake = new FakeBot()
			let deletions = 0
			fake.memory.deleteEntry = () => {
				deletions++
				return true
			}
			const bot = fake as unknown as Bot
			const calls = [
				{
					callId: 'terminal',
					name: terminal,
					arguments:
						terminal === 'mine_resource'
							? { block_name: 'stone', count: 1 }
							: {}
				},
				{ callId: 'inline', name: 'memory_delete', arguments: { id: 'known' } }
			]
			const result = await runAgentTurn({
				bot,
				memory: bot.memory,
				currentGoal: 'Gather',
				subGoal: null,
				lastAction: null,
				lastResult: null,
				lastReason: null,
				errorHistory: [],
				taskContext: createTaskContext('Gather', null),
				client: {
					createResponse: async () => ({
						id: 'mixed',
						outputText: '',
						toolCalls: reverse ? calls.reverse() : calls
					})
				}
			})
			assert.equal(result.kind, 'rejected', terminal)
			assert.equal(deletions, 0, terminal)
		}
	}
})

test('failed window close does not block emergency recovery', async () => {
	const { bot, actor } = createTestActor()
	bot.blockAt = () => ({ name: 'furnace', position: createVec3(1, 64, 1) })
	bot.openFurnace = async () =>
		trackWindow(bot, {
			slots: [],
			close() {
				throw new Error('close failed')
			}
		})
	try {
		await actor.getSnapshot().context.windows!.open({ x: 1, y: 64, z: 1 })
		actor.send({ type: 'UPDATE_HEALTH', health: 8 })
		assert.ok(
			actor
				.getSnapshot()
				.matches({ MAIN_ACTIVITY: { URGENT_NEEDS: 'EMERGENCY_HEALING' } })
		)
		assert.equal(
			actor.getSnapshot().context.windows!.getSnapshot().state,
			'close_failed'
		)
	} finally {
		actor.stop()
	}
})

test('stopping the machine releases its window without a final transition', async () => {
	const { bot, actor } = createTestActor()
	bot.blockAt = () => ({ name: 'furnace', position: createVec3(1, 64, 1) })
	bot.openFurnace = async () => trackWindow(bot, { slots: [], close() {} })
	try {
		await actor.getSnapshot().context.windows!.open({ x: 1, y: 64, z: 1 })
		assert.ok(bot.currentWindow)
		actor.stop()
		assert.equal(bot.currentWindow, null)
		assert.equal(
			actor.getSnapshot().context.windows!.getSnapshot().session,
			null
		)
	} finally {
		actor.stop()
	}
})
