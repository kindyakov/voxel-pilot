import assert from 'node:assert/strict'
import test from 'node:test'
import { setImmediate as flushEffects } from 'node:timers/promises'
import { stripVTControlCharacters } from 'node:util'

import type { HarnessSummary, Measurement } from '@voxel-pilot/contracts'

import { Dashboard } from '../app/App.js'
import {
	type TuiApplicationOptions,
	startTuiApplication
} from '../app/application.js'
import { ManualClock } from './fixtures/clock.js'
import { publicRuntime } from './fixtures/runtime.js'
import { ManualStatusClock } from './fixtures/statusClock.js'
import { Input, Output } from './fixtures/terminal.js'

function fixture(
	t: test.TestContext,
	options: Partial<TuiApplicationOptions> = {}
) {
	const source = publicRuntime()
	const stdin = new Input(),
		stdout = new Output(),
		stderr = new Output()
	const clock = new ManualStatusClock()
	const deadlineClock = new ManualClock()
	let compositions = 0
	const app = startTuiApplication({
		streams: { stdin, stdout, stderr },
		signals: source.signals,
		clock: deadlineClock,
		statusClock: clock,
		compose: () => {
			compositions++
			return { runtime: source.runtime, loggerHandle: { async close() {} } }
		},
		...options
	})
	t.after(async () => {
		await app.shutdown()
		await flushEffects()
		assert.equal(clock.pending, 0)
		assert.equal(
			source.counts().activeSnapshots + source.counts().activeLogs,
			0
		)
		stdin.destroy()
		stdout.destroy()
		stderr.destroy()
	})
	return {
		...source,
		app,
		stdin,
		stdout,
		stderr,
		clock,
		deadlineClock,
		compositions: () => compositions
	}
}

// Pinned Ink uses native nonincremental log-update: each changed write contains a full frame.
// Read the latest actual frame so an old value in cumulative output cannot satisfy an assertion.
function frame(stdout: Output): string {
	const output = stripVTControlCharacters(stdout.chunks.join(''))
	const start = output.lastIndexOf('VoxelPilot')
	assert.ok(start >= 0, 'native frame must contain the real Dashboard header')
	return output.slice(start)
}

const measured = <T,>(value: T, stale = false): Measurement<T> => ({
	value,
	updatedAt: 9000,
	stale
})
const unknown = { value: null, updatedAt: null, stale: false }
function harness(overrides: Partial<HarnessSummary> = {}): HarnessSummary {
	return {
		mainActivity: 'TASKS.EXECUTING.MINING.BREAKING',
		enteredAt: 10000,
		action: 'mine_resource',
		monitoring: [
			'ENTITIES_MONITOR.RUNNING',
			'HEALTH_MONITOR',
			'HUNGER_MONITOR'
		],
		goal: { status: 'active', text: 'Добудь 20 блоков камня' },
		...overrides
	}
}

test('default full application displays unknown status rather than native defaults or an absent goal', async t => {
	const f = fixture(t)
	await f.app.ready
	await f.app.flush()
	const output = frame(f.stdout)
	assert.match(output, /HP: — \/ —/)
	assert.match(output, /Сытость: — \/ 20/)
	assert.match(output, /ПОЗИЦИЯ: X — · Y — · Z —/)
	assert.match(output, /HSM: —/)
	assert.match(output, /Время состояния: —/)
	assert.match(output, /ЦЕЛЬ: —/)
	assert.doesNotMatch(output, /Нет поручения/)
	assert.equal(f.clock.pending, 1)
	assert.deepEqual(f.counts(), {
		startCalls: 1,
		stopCalls: 0,
		snapshotSubscriptions: 1,
		logSubscriptions: 1,
		activeSnapshots: 1,
		activeLogs: 1
	})
})

test('real frames show measured maxHealth 30 and 63, indicators, coordinates and zero without defaults', async t => {
	const f = fixture(t)
	await f.app.ready
	f.publish({
		health: measured(18),
		maxHealth: measured(30),
		food: measured(16),
		position: measured({ x: 169.44, y: 68, z: 48.35 }),
		harness: measured(harness())
	})
	await f.app.flush()
	let output = frame(f.stdout)
	assert.match(output, /HP: 18 \/ 30 \[######----\]/)
	assert.match(output, /Сытость: 16 \/ 20 \[########--\]/)
	assert.match(output, /ПОЗИЦИЯ: X 169.44 · Y 68 · Z 48.35/)
	assert.match(output, /HSM: TASKS > EXECUTING > MINING > BREAKING/)
	assert.match(output, /Действие: mine_resource/)
	assert.match(output, /ЦЕЛЬ: В работе/)
	assert.match(output, /Добудь 20 блоков камня/)
	f.publish({ health: measured(42), maxHealth: measured(63) })
	await f.app.flush()
	assert.match(frame(f.stdout), /HP: 42 \/ 63 \[#######---\]/)
	f.publish({
		health: measured(0),
		food: measured(0),
		position: measured({ x: 0, y: 0, z: 0 })
	})
	await f.app.flush()
	output = frame(f.stdout)
	assert.match(output, /HP: 0 \/ 63 \[----------\]/)
	assert.match(output, /Сытость: 0 \/ 20 \[----------\]/)
	assert.match(output, /ПОЗИЦИЯ: X 0 · Y 0 · Z 0/)
	f.publish({ maxHealth: unknown })
	await f.app.flush()
	assert.match(frame(f.stdout), /HP: 0 \/ — \[—\]/)
})

test('one display schedule advances unchanged snapshots; monitoring and nested main state have independent timers', async t => {
	const f = fixture(t)
	await f.app.ready
	f.publish({ harness: measured(harness()) })
	await f.app.flush()
	const stable = f.runtime.telemetry.getSnapshot()
	const counts = f.counts()
	f.clock.advance(25000)
	await flushEffects()
	await f.app.flush()
	assert.match(frame(f.stdout), /Время состояния: 00:25/)
	assert.equal(f.runtime.telemetry.getSnapshot(), stable)
	assert.deepEqual(f.counts(), counts)
	assert.equal(f.clock.pending, 1)
	assert.ok(f.clock.delays.every(delay => delay === 1000))
	f.publish({
		food: measured(15),
		harness: measured(
			harness({
				monitoring: ['ENTITIES_MONITOR.RETRYING'],
				action: null,
				goal: { status: 'paused', text: 'Сохранённая цель' }
			})
		)
	})
	f.append('log revision is independent')
	await f.app.flush()
	assert.match(frame(f.stdout), /Время состояния: 00:25/)
	assert.match(frame(f.stdout), /Мониторинг: ENTITIES_MONITOR > RETRYING/)
	f.clock.advance(1000)
	await flushEffects()
	await f.app.flush()
	assert.match(frame(f.stdout), /Время состояния: 00:26/)
	f.publish({
		harness: measured(
			harness({
				mainActivity: 'TASKS.EXECUTING.MINING.CHECKING_GOAL',
				enteredAt: f.clock.now()
			})
		)
	})
	await f.app.flush()
	assert.match(
		frame(f.stdout),
		/HSM: TASKS > EXECUTING > MINING > CHECKING_GOAL/
	)
	assert.match(frame(f.stdout), /Время состояния: 00:00/)
	f.clock.advance(5000)
	await flushEffects()
	await f.app.flush()
	assert.match(frame(f.stdout), /Время состояния: 00:05/)
	assert.equal(f.compositions(), 1)
	assert.equal(f.counts().startCalls, 1)
	assert.equal(f.counts().snapshotSubscriptions, 1)
	assert.equal(f.counts().logSubscriptions, 1)
	assert.equal(f.deadlineClock.pending, 0)
})

test('known none, active combat and paused goal differ from unknown and from current action', async t => {
	const f = fixture(t)
	await f.app.ready
	f.publish({
		harness: measured(
			harness({
				mainActivity: 'IDLE',
				action: null,
				goal: { status: 'none', text: null }
			})
		)
	})
	await f.app.flush()
	assert.match(frame(f.stdout), /ЦЕЛЬ: Нет поручения/)
	assert.match(frame(f.stdout), /Действие: Нет/)
	f.publish({
		harness: measured(
			harness({
				mainActivity: 'COMBAT.MELEE_ATTACKING',
				action: 'melee_attack'
			})
		)
	})
	await f.app.flush()
	assert.match(frame(f.stdout), /HSM: COMBAT > MELEE_ATTACKING/)
	assert.match(frame(f.stdout), /Действие: melee_attack/)
	assert.match(frame(f.stdout), /ЦЕЛЬ: В работе/)
	assert.doesNotMatch(frame(f.stdout), /Действие: mine_resource|На паузе/)
	f.publish({
		harness: measured(
			harness({
				mainActivity: 'IDLE',
				action: null,
				goal: { status: 'paused', text: 'Добудь 20 блоков камня' }
			})
		)
	})
	await f.app.flush()
	assert.match(frame(f.stdout), /ЦЕЛЬ: На паузе/)
	assert.match(frame(f.stdout), /Добудь 20 блоков камня/)
	assert.doesNotMatch(frame(f.stdout), /Нет поручения|Действие: melee_attack/)
})

test('disconnect retains visibly stale individual facts and historical timer; a new session clears every old fact', async t => {
	const f = fixture(t)
	await f.app.ready
	f.publish({
		connection: {
			...f.runtime.telemetry.getSnapshot().connection,
			state: 'ready',
			sessionId: 1
		},
		health: measured(18),
		maxHealth: measured(30),
		food: measured(16),
		position: measured({ x: 169.44, y: 68, z: 48.35 }),
		harness: measured(harness())
	})
	f.clock.advance(25000)
	await flushEffects()
	await f.app.flush()
	const fresh = f.runtime.telemetry.getSnapshot()
	f.publish({
		connection: {
			...fresh.connection,
			state: 'reconnecting',
			changedAt: 35000
		},
		health: { ...fresh.health, stale: true },
		maxHealth: { ...fresh.maxHealth, stale: true },
		food: { ...fresh.food, stale: true },
		position: { ...fresh.position, stale: true },
		harness: { ...fresh.harness, stale: true }
	})
	f.clock.advance(2000)
	await flushEffects()
	await f.app.flush()
	let output = frame(f.stdout)
	assert.match(output, /HP: 18 \(устарело\) \/ 30 \(устарело\)/)
	assert.match(output, /Сытость: 16 \(устарело\) \/ 20/)
	assert.match(output, /ПОЗИЦИЯ: X 169.44 · Y 68 · Z 48.35 · устарело/)
	assert.match(output, /От входа в последнее состояние: 00:27 · устарело/)
	assert.match(output, /ЦЕЛЬ: В работе · устарело/)
	assert.equal(
		f.runtime.telemetry.getSnapshot().harness.updatedAt,
		fresh.harness.updatedAt
	)
	f.publish({ health: measured(19), food: measured(17) })
	await f.app.flush()
	output = frame(f.stdout)
	assert.match(output, /HP: 19 \/ 30 \(устарело\)/)
	assert.match(output, /Сытость: 17 \/ 20/)
	assert.doesNotMatch(output, /19 \(устарело\)|17 \(устарело\)/)
	assert.match(output, /ПОЗИЦИЯ: X 169.44 · Y 68 · Z 48.35 · устарело/)
	f.publish({
		connection: {
			...fresh.connection,
			state: 'connecting',
			sessionId: 2,
			changedAt: 37000
		},
		health: unknown,
		maxHealth: unknown,
		food: unknown,
		position: unknown,
		harness: unknown
	})
	await f.app.flush()
	output = frame(f.stdout)
	assert.match(output, /HP: — \/ —/)
	assert.match(output, /ПОЗИЦИЯ: X — · Y — · Z —/)
	assert.match(output, /HSM: —/)
	assert.match(output, /Время состояния: —/)
	assert.doesNotMatch(output, /Добудь|mine_resource|169\.44|устарело/)
	f.publish({
		health: measured(0),
		harness: measured(
			harness({
				mainActivity: 'IDLE',
				enteredAt: f.clock.now(),
				action: null,
				monitoring: [],
				goal: { status: 'none', text: null }
			})
		)
	})
	await f.app.flush()
	assert.match(frame(f.stdout), /HP: 0 \/ —/)
	assert.match(frame(f.stdout), /Время состояния: 00:00/)
	assert.match(frame(f.stdout), /ЦЕЛЬ: Нет поручения/)
	f.clock.advance(1000)
	await flushEffects()
	await f.app.flush()
	assert.match(frame(f.stdout), /Время состояния: 00:01/)
})

test('status text neutralizes terminal controls while retaining the public snapshot', async t => {
	const f = fixture(t)
	await f.app.ready
	f.stdout.resize(100, 40)
	const text = 'Цель\n\u001b]0;INJECTED\u0007\t🙂 ' + 'длинная '.repeat(45)
	f.publish({
		harness: measured(harness({ goal: { status: 'paused', text } }))
	})
	await f.app.flush()
	assert.match(frame(f.stdout), /Цель ↵ \\u001b\]0;INJECTED\\u0007/)
	assert.match(frame(f.stdout), /На паузе/)
	assert.match(frame(f.stdout), /…/)
	assert.ok(!f.stdout.chunks.join('').includes('\u001b]0;INJECTED\u0007'))
	assert.equal(f.runtime.telemetry.getSnapshot().harness.value?.goal.text, text)
})

test('tiny-screen unmount cancels clock; remount reads current time without resetting state or public bridge', async t => {
	const f = fixture(t)
	await f.app.ready
	f.publish({ harness: measured(harness()) })
	await f.app.flush()
	f.clock.advance(25000)
	await flushEffects()
	await f.app.flush()
	assert.match(frame(f.stdout), /Время состояния: 00:25/)
	f.stdout.resize(35, 6)
	await flushEffects()
	await f.app.flush()
	await flushEffects()
	assert.match(frame(f.stdout), /Увеличьте окно/)
	assert.equal(f.clock.pending, 0)
	f.clock.advance(10000)
	f.stdout.resize(100, 24)
	await flushEffects()
	await f.app.flush()
	await flushEffects()
	assert.match(frame(f.stdout), /Время состояния: 00:35/)
	assert.equal(f.clock.pending, 1)
	assert.equal(f.compositions(), 1)
	assert.equal(f.counts().snapshotSubscriptions, 1)
	assert.equal(f.counts().logSubscriptions, 1)
	f.stdin.send('\u0003')
	assert.equal((await f.app.done).exitCode, 0)
	assert.equal(f.clock.pending, 0)
	assert.equal(f.stdin.isRaw, false)
})

test('replacing the injected status clock releases its previous schedule', async t => {
	const first = new ManualStatusClock(35000),
		second = new ManualStatusClock(45000)
	let selected = first
	const f = fixture(t, {
		view(props) {
			return <Dashboard {...props} statusClock={selected} />
		}
	})
	await f.app.ready
	f.publish({ harness: measured(harness()) })
	await f.app.flush()
	assert.match(frame(f.stdout), /Время состояния: 00:25/)
	assert.equal(first.pending, 1)
	selected = second
	f.publish({ food: measured(16) })
	await f.app.flush()
	assert.equal(first.pending, 0)
	assert.equal(second.pending, 1)
	assert.match(frame(f.stdout), /Время состояния: 00:35/)
	await f.app.shutdown()
	assert.equal(second.pending, 0)
})

test('asynchronous status clock failure is isolated to the panel and leaves native exit usable', async t => {
	let failed = false
	const clock = new ManualStatusClock()
	const f = fixture(t, {
		statusClock: {
			now() {
				if (failed) throw new Error('private fixture clock failure')
				return clock.now()
			},
			schedule: clock.schedule.bind(clock)
		}
	})
	await f.app.ready
	failed = true
	clock.advance(1000)
	await flushEffects()
	await f.app.flush()
	assert.match(frame(f.stdout), /Status view unavailable/)
	assert.match(frame(f.stdout), /CONNECTING/)
	assert.doesNotMatch(frame(f.stdout), /private fixture clock failure/)
	assert.ok(!f.stderr.text().includes('private fixture clock failure'))
	assert.equal(clock.pending, 0)
	assert.equal(f.counts().stopCalls, 0)
	f.stdin.send('q')
	assert.equal((await f.app.done).exitCode, 0)
})
