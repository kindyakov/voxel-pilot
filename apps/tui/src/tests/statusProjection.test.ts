import assert from 'node:assert/strict'
import test from 'node:test'

import type { HarnessSummary, Measurement } from '@voxel-pilot/contracts'

import {
	formatElapsed,
	formatNumber,
	toStatusView
} from '../features/status/projection.js'
import { publicRuntime } from './fixtures/runtime.js'

const measured = <T>(value: T | null, stale = false): Measurement<T> => ({
	value,
	updatedAt: value === null ? null : 9000,
	stale
})
const summary: HarnessSummary = {
	mainActivity: 'TASKS.EXECUTING.MINING.BREAKING',
	enteredAt: 10000,
	action: 'mine_resource',
	monitoring: ['ENTITIES_MONITOR.RUNNING', 'HEALTH_MONITOR', 'HUNGER_MONITOR'],
	goal: { status: 'active', text: 'Добудь 20 блоков камня' }
}

test('unknown measurements are distinct from zero and a known absent goal', () => {
	const f = publicRuntime()
	const unknown = toStatusView(f.runtime.telemetry.getSnapshot(), 10000)
	assert.equal(unknown.health.text, '—')
	assert.equal(unknown.healthRatio, null)
	assert.equal(unknown.foodRatio, null)
	assert.equal(unknown.position.text, 'X — · Y — · Z —')
	assert.deepEqual(unknown.harness.goal, {
		status: 'unknown',
		label: '—',
		text: null
	})
	assert.deepEqual(unknown.harness.monitoring, ['—'])
	f.publish({
		health: measured(0),
		food: measured(0),
		position: measured({ x: 0, y: 0, z: 0 })
	})
	const zero = toStatusView(f.runtime.telemetry.getSnapshot(), 10000)
	assert.equal(zero.health.text, '0')
	assert.equal(zero.healthRatio, null)
	assert.equal(zero.foodRatio, 0)
	assert.equal(zero.position.text, 'X 0 · Y 0 · Z 0')
	f.publish({
		maxHealth: measured(30),
		harness: measured({
			...summary,
			action: null,
			monitoring: [],
			goal: { status: 'none', text: null }
		})
	})
	const known = toStatusView(f.runtime.telemetry.getSnapshot(), 10000)
	assert.equal(known.healthRatio, 0)
	assert.equal(known.harness.goal.label, 'Нет поручения')
	assert.equal(known.harness.action, 'Нет')
	assert.deepEqual(known.harness.monitoring, ['Нет'])
})

test('health ratio uses dynamic measured max without rewriting observed numbers', () => {
	const f = publicRuntime()
	for (const [health, maximum, expected] of [
		[18, 30, 0.6],
		[42, 63, 2 / 3],
		[80, 30, 1],
		[-1, 30, 0],
		[0, 0, null]
	] as const) {
		f.publish({ health: measured(health), maxHealth: measured(maximum) })
		const view = toStatusView(f.runtime.telemetry.getSnapshot(), 0)
		assert.equal(view.healthRatio, expected)
		assert.equal(view.health.text, String(health))
		assert.equal(view.maxHealth.text, String(maximum))
	}
	f.publish({ health: measured(18), maxHealth: measured<number>(null) })
	assert.equal(
		toStatusView(f.runtime.telemetry.getSnapshot(), 0).healthRatio,
		null
	)
	f.publish({ maxHealth: measured(Number.POSITIVE_INFINITY) })
	assert.equal(
		toStatusView(f.runtime.telemetry.getSnapshot(), 0).maxHealth.text,
		'—'
	)
})

test('each measurement keeps its own stale fact; harness goal and action remain independent', () => {
	const f = publicRuntime()
	f.publish({
		health: measured(18),
		maxHealth: measured(30, true),
		food: measured(16, true),
		position: measured({ x: -169.444, y: 68, z: -0.001 }, true),
		harness: measured(
			{
				...summary,
				mainActivity: 'COMBAT.MELEE_ATTACKING',
				action: 'melee_attack'
			},
			true
		)
	})
	const view = toStatusView(f.runtime.telemetry.getSnapshot(), 35000)
	assert.equal(view.health.stale, false)
	assert.equal(view.maxHealth.stale, true)
	assert.equal(view.food.stale, true)
	assert.deepEqual(view.position, {
		text: 'X -169.44 · Y 68 · Z 0',
		stale: true
	})
	assert.equal(view.harness.stale, true)
	assert.equal(view.harness.action, 'melee_attack')
	assert.equal(view.harness.goal.status, 'active')
	assert.equal(view.harness.elapsed, '00:25')
	f.publish({
		harness: measured({
			...summary,
			mainActivity: 'IDLE',
			action: null,
			goal: { status: 'paused', text: summary.goal.text ?? '' }
		})
	})
	const paused = toStatusView(f.runtime.telemetry.getSnapshot(), 36000)
	assert.equal(paused.harness.goal.label, 'На паузе')
	assert.equal(paused.harness.goal.text, summary.goal.text)
	assert.equal(paused.harness.action, 'Нет')
})

test('all main and monitoring leaf segments survive projection and only enteredAt supplies duration', () => {
	const f = publicRuntime()
	f.publish({ harness: measured(summary) })
	const before = f.runtime.telemetry.getSnapshot()
	assert.equal(
		toStatusView(before, 35000).harness.mainActivity,
		'TASKS > EXECUTING > MINING > BREAKING'
	)
	f.publish({
		harness: measured({
			...summary,
			monitoring: ['ENTITIES_MONITOR.RETRYING'],
			goal: { status: 'paused', text: 'Сохранённая цель' }
		}),
		food: measured(15)
	})
	const after = f.runtime.telemetry.getSnapshot()
	assert.equal(toStatusView(after, 35000).harness.elapsed, '00:25')
	assert.deepEqual(toStatusView(after, 35000).harness.monitoring, [
		'ENTITIES_MONITOR > RETRYING'
	])
	assert.equal(before.harness.value?.enteredAt, 10000)
	assert.equal(after.harness.value?.enteredAt, 10000)
	assert.equal(toStatusView(after, 36000).harness.elapsed, '00:26')
})

test('public fake copies and freezes measured DTOs instead of retaining mutable caller values', () => {
	const f = publicRuntime()
	const position = { x: 1, y: 2, z: 3 }
	const monitoring = ['HEALTH_MONITOR']
	const goal = { status: 'paused' as const, text: 'Цель' }
	f.publish({
		position: measured(position),
		harness: measured({ ...summary, monitoring, goal })
	})
	position.x = 99
	monitoring.push('NEW')
	goal.text = 'Изменена'
	const snapshot = f.runtime.telemetry.getSnapshot()
	assert.equal(snapshot.position.value?.x, 1)
	assert.deepEqual(snapshot.harness.value?.monitoring, ['HEALTH_MONITOR'])
	assert.equal(snapshot.harness.value?.goal.text, 'Цель')
	assert.equal(Object.isFrozen(snapshot), true)
	assert.equal(Object.isFrozen(snapshot.harness.value?.monitoring), true)
	assert.equal(Object.isFrozen(snapshot.position.value), true)
})

for (const [entry, now, expected] of [
	[10000, 10000, '00:00'],
	[10000, 35999, '00:25'],
	[10000, 70000, '01:00'],
	[0, 3723000, '01:02:03'],
	[0, 90000000, '25:00:00'],
	[20000, 10000, '00:00'],
	[0, Number.NaN, '—'],
	[Number.POSITIVE_INFINITY, 1, '—']
] as const) {
	test(`duration from ${entry} to ${now} renders ${expected}`, () => {
		assert.equal(formatElapsed(entry, now), expected)
	})
}

test('numeric display trims precision and has no defaults for non-finite inputs', () => {
	for (const [input, expected] of [
		[null, '—'],
		[0, '0'],
		[-0, '0'],
		[-0.001, '0'],
		[169.444, '169.44'],
		[68, '68'],
		[Number.NaN, '—'],
		[Number.NEGATIVE_INFINITY, '—']
	] as const)
		assert.equal(formatNumber(input), expected)
})
