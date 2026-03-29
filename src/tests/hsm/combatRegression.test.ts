import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { createRequire } from 'node:module'
import test from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'

import { Vec3 } from 'vec3'
import { createActor } from 'xstate'

import combatActors from '../../hsm/actors/combat.actors.js'
import { canAttackEnemy } from '../../utils/combat/enemyVisibility.js'

const require = createRequire(import.meta.url)
const minecraftData = require('minecraft-data')

const createEnemy = (id: number, distance: number) => ({
	id,
	type: 'hostile',
	name: 'skeleton',
	height: 1.8,
	isValid: true,
	position: new Vec3(distance, 64, 0)
})

const waitForCondition = async (
	condition: () => boolean,
	timeoutMs: number
) => {
	const started = Date.now()
	while (!condition()) {
		if (Date.now() - started > timeoutMs) {
			throw new Error(`Condition not reached in ${timeoutMs}ms`)
		}
		await delay(25)
	}
}

class CombatServiceBot extends EventEmitter {
	entity = {
		id: 999,
		position: new Vec3(0, 64, 0),
		height: 1.8,
		effects: {}
	}
	entities = {}
	registry = {
		isNewerOrEqualTo: () => true
	}
	inventory = {
		items: () => []
	}
	movements = {
		allowSprinting: true,
		allowParkour: true
	}
	pathfinder = {
		setGoal: () => {},
		getPathFromTo: function* () {}
	}
	pvpAttackCalls = 0
	pvpStopCalls = 0
	hawkEyeAutoAttackCalls = 0
	hawkEyeStopCalls = 0
	rangeWeaponEnabled = true
	meleeWeaponEnabled = true
	pvp = {
		attack: () => {
			this.pvpAttackCalls += 1
		},
		stop: () => {
			this.pvpStopCalls += 1
		}
	}
	hawkEye = {
		autoAttack: () => {
			this.hawkEyeAutoAttackCalls += 1
		},
		stop: () => {
			this.hawkEyeStopCalls += 1
		}
	}
	utils = {
		getMeleeWeapon: () =>
			this.meleeWeaponEnabled
				? ({ name: 'iron_sword', type: 1, count: 1 } as any)
				: null,
		getRangeWeapon: () =>
			this.rangeWeaponEnabled
				? ({ name: 'bow', type: 1, count: 1 } as any)
				: null,
		getArrow: () =>
			this.rangeWeaponEnabled
				? ({ name: 'arrow', type: 1, count: 16 } as any)
				: null
	}
	contextRef: any = null
	hsm = {
		getContext: () => this.contextRef
	}
	blockAt = () => null
	async equip() {}
}

const createCombatContext = (
	bot: CombatServiceBot,
	enemy: ReturnType<typeof createEnemy>,
	distance: number
) => ({
	bot,
	nearestEnemy: {
		entity: enemy,
		distance
	},
	preferences: {
		maxDistToEnemy: 20,
		enemyRangedRange: 8,
		enemyMeleeRange: 5
	}
})

test('regression: melee service cleanup should stop active pvp attacks', async () => {
	const bot = new CombatServiceBot()
	const enemy = createEnemy(201, 4)
	bot.contextRef = createCombatContext(bot, enemy, 4)

	const actor = createActor(combatActors.serviceMeleeAttack as any, {
		input: { bot, options: {} }
	})
	actor.start()

	try {
		await waitForCondition(() => bot.pvpAttackCalls > 0, 2500)
		actor.stop()

		assert.ok(
			bot.pvpStopCalls > 0,
			'expected pvp.stop on cleanup when melee target was active'
		)
	} finally {
		actor.stop()
	}
})

test('regression: ranged service cleanup should stop active hawkEye attacks', async () => {
	const bot = new CombatServiceBot()
	const enemy = createEnemy(202, 12)
	bot.contextRef = createCombatContext(bot, enemy, 12)

	const actor = createActor(combatActors.serviceRangedAttack as any, {
		input: { bot, options: {} }
	})
	actor.start()

	try {
		await waitForCondition(() => bot.hawkEyeAutoAttackCalls > 0, 4500)
		actor.stop()

		assert.ok(
			bot.hawkEyeStopCalls > 0,
			'expected hawkEye.stop on cleanup when ranged target was active'
		)
	} finally {
		actor.stop()
	}
})

const createOpaqueBlock = () => ({
	boundingBox: 'block',
	transparent: false,
	material: 'stone'
})

const createPathfindingHarness = () => {
	const registry = minecraftData('1.20.4')
	let getPathFromToCalls = 0

	const bot = {
		entity: {
			position: new Vec3(0, 64, 0),
			height: 1.8,
			effects: {}
		},
		entities: {},
		registry,
		game: {
			minY: -64
		},
		inventory: {
			items: () => []
		},
		movements: {
			allowParkour: true,
			allowSprinting: true
		},
		blockAt: () => createOpaqueBlock(),
		pathfinder: {
			getPathFromTo: function* () {
				getPathFromToCalls += 1
				yield {
					result: {
						status: 'success',
						path: [new Vec3(0, 64, 0), new Vec3(1, 64, 0), new Vec3(2, 64, 0)]
					}
				}
			}
		}
	}

	return {
		bot,
		getPathFromToCalls: () => getPathFromToCalls
	}
}

test('control: canAttackEnemy can use pathfinding when task is inactive', async () => {
	const { bot, getPathFromToCalls } = createPathfindingHarness()
	const enemy = createEnemy(203, 3)

	const canAttack = await canAttackEnemy(
		bot as any,
		enemy as any,
		20,
		40,
		100,
		false
	)

	assert.equal(canAttack, true)
	assert.equal(getPathFromToCalls(), 1)
})

test('regression: canAttackEnemy should not pathfind non-visible enemies during active tasks', async () => {
	const { bot, getPathFromToCalls } = createPathfindingHarness()
	const enemy = createEnemy(204, 3)

	const canAttack = await canAttackEnemy(
		bot as any,
		enemy as any,
		20,
		40,
		100,
		true
	)

	assert.equal(canAttack, false)
	assert.equal(getPathFromToCalls(), 0)
})
