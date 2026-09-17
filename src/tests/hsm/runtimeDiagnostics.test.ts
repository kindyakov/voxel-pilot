import assert from 'node:assert/strict'
import test from 'node:test'
import { setImmediate as flush } from 'node:timers/promises'

import { Vec3 } from 'vec3'

import Logger from '@/config/logger.js'

import { attachHsmDiagnostics } from '@/hsm/utils/runtimeDiagnostics.js'

import { createHarness } from './fixtures/handoffBot.js'

test('diagnostics expose nested recovery, bounded heartbeat and stop without leaking command text', async t => {
	t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] })
	const logs: Array<{ message: string; meta: Record<string, unknown> }> = []
	t.mock.method(
		Logger,
		'info',
		(message: string, meta: Record<string, unknown> = {}) => {
			logs.push({ message, meta })
		}
	)
	const { actor, observe } = createHarness()
	t.after(() => actor.stop())
	const detach = attachHsmDiagnostics(actor, '1.20.1')
	t.after(detach)
	const runtime = logs.find(log => log.message === '[HSM] runtime')
	assert.equal(
		runtime?.meta.rangedAttackRange,
		actor.getSnapshot().context.preferences.rangedAttackRange
	)
	assert.equal(
		runtime?.meta.meleeSwitchDistance,
		actor.getSnapshot().context.preferences.enemyMeleeRange
	)
	actor.send({
		type: 'USER_COMMAND',
		username: 'PrivateName',
		text: 'PRIVATE_GOAL_TOKEN'
	})
	actor.send({ type: 'UPDATE_HEALTH', health: 8 })
	observe()
	await flush()
	assert.ok(
		logs.some(
			log =>
				log.message === '[HSM] transition' &&
				String(log.meta.to).includes(
					'URGENT_NEEDS.EMERGENCY_HEALING.RUNNING'
				) &&
				log.meta.event === 'UPDATE_HEALTH'
		)
	)
	actor.send({ type: 'ERROR', error: 'test failure' })
	assert.ok(
		logs.some(log => String(log.meta.to).includes('EMERGENCY_HEALING.RETRYING'))
	)
	for (let i = 0; i < 50; i++) {
		t.mock.timers.tick(100)
		await flush()
	}
	assert.equal(logs.filter(log => log.message === '[HSM] heartbeat').length, 1)
	const heartbeat = logs.find(log => log.message === '[HSM] heartbeat')
	assert.equal(heartbeat?.meta.displacement, 0)
	assert.equal(JSON.stringify(logs).includes('PRIVATE_GOAL_TOKEN'), false)
	actor.stop()
	const count = logs.length
	t.mock.timers.tick(15000)
	await flush()
	assert.equal(logs.length, count)
})

test('target rejection logs identify the version, unknown species and weapon without spamming ticks', async t => {
	t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] })
	const logs: Array<{ message: string; meta: Record<string, unknown> }> = []
	t.mock.method(
		Logger,
		'info',
		(message: string, meta: Record<string, unknown> = {}) => {
			logs.push({ message, meta })
		}
	)
	const { bot, actor, enemy } = createHarness(true, '1.20.1')
	t.after(() => actor.stop())
	enemy.name = 'unknown_modded_monster'
	bot.entities = { 1: enemy }
	await flush()
	for (let i = 0; i < 15; i++) {
		t.mock.timers.tick(100)
		await flush()
	}
	const decisions = logs.filter(
		log => log.message === '[COMBAT] target_decision'
	)
	assert.equal(decisions.length, 1)
	assert.equal(decisions[0]?.meta.minecraftVersion, '1.20.1')
	assert.equal(decisions[0]?.meta.targetId, null)
	assert.ok(JSON.stringify(decisions[0]).includes('species_unknown'))
	assert.ok(JSON.stringify(decisions[0]).includes('iron_sword'))
	assert.equal(
		bot.attacks.length,
		0,
		'diagnostics must not change attack policy'
	)
	assert.equal(
		logs.some(log => log.message === '[SURVIVAL] decision'),
		false
	)
	assert.ok(actor.getSnapshot().matches({ MAIN_ACTIVITY: 'IDLE' }))
})

test('search logs distinguish a selected path from actual displacement', async t => {
	t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] })
	const logs: Array<{ message: string; meta: Record<string, unknown> }> = []
	t.mock.method(
		Logger,
		'info',
		(message: string, meta: Record<string, unknown> = {}) => {
			logs.push({ message, meta })
		}
	)
	const { bot, actor, enemy, observe, step } = createHarness()
	t.after(() => actor.stop())
	enemy.position = new Vec3(18, 64, 0)
	actor.send({ type: 'UPDATE_HEALTH', health: 8 })
	observe()
	await flush()
	for (let i = 0; i < 20; i++) {
		t.mock.timers.tick(50)
		await flush()
		step()
	}
	assert.equal(
		logs.filter(log => log.message === '[SURVIVAL] route_search_started')
			.length,
		1
	)
	assert.ok(
		logs.some(
			log =>
				log.message === '[SURVIVAL] route_search_finished' &&
				log.meta.status === 'success'
		)
	)
	assert.ok(bot.entity.position.x < -2)
})
