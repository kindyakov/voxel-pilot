import assert from 'node:assert/strict'
import test from 'node:test'
import { setImmediate as flushEffects } from 'node:timers/promises'
import { stripVTControlCharacters } from 'node:util'

import type { LogViewSnapshot } from '@voxel-pilot/presentation'

import { Dashboard, type DashboardProps } from '../app/App.js'
import { startTuiApplication } from '../app/application.js'
import { compactLogMessage } from '../terminal/display.js'
import { logPageSize } from '../terminal/logNavigation.js'
import { ManualClock } from './fixtures/clock.js'
import { deferred, publicRuntime, saved } from './fixtures/runtime.js'
import { ManualStatusClock } from './fixtures/statusClock.js'
import { Input, Output } from './fixtures/terminal.js'

function fixture(t: test.TestContext, clockThrows = false) {
	const source = publicRuntime()
	source.append('earlier retained DEBUG', 'debug')
	source.append('first INFO')
	source.append('second WARN', 'warn')
	source.append('third ERROR', 'error')
	const stdin = new Input(),
		stdout = new Output(),
		stderr = new Output()
	const clock = new ManualClock()
	const statusClock = new ManualStatusClock()
	// The composed status panel needs room alongside the four initial log records.
	stdout.rows = 40
	const beforeExit = process.listenerCount('beforeExit')
	let current!: LogViewSnapshot
	let closes = 0
	const app = startTuiApplication({
		streams: { stdin, stdout, stderr },
		signals: source.signals,
		clock,
		statusClock,
		shutdownTimeoutMs: 100,
		displayClock: {
			formatTimestamp() {
				if (clockThrows) throw new Error('private log widget fixture')
				return '12:34:56'
			}
		},
		view(props: DashboardProps) {
			current = props.logView
			return <Dashboard {...props} />
		},
		compose: () => ({
			runtime: source.runtime,
			loggerHandle: {
				async close() {
					closes++
				}
			}
		})
	})
	t.after(async () => {
		void app.shutdown()
		clock.advance(100)
		stdout.release()
		await app.done
		await flushEffects()
		assert.equal(statusClock.pending, 0)
		assert.equal(process.listenerCount('beforeExit'), beforeExit)
		assert.equal(
			source.counts().activeLogs + source.counts().activeSnapshots,
			0
		)
		assert.equal(stdin.listenerCount('readable'), 0)
		assert.equal(stdout.listenerCount('resize'), 0)
		stdin.destroy()
		stdout.destroy()
		stderr.destroy()
	})
	const frame = async (action: () => void) => {
		const start = stdout.chunks.length
		action()
		await flushEffects()
		await app.flush()
		return stripVTControlCharacters(stdout.chunks.slice(start).join(''))
	}
	return {
		...source,
		app,
		stdin,
		stdout,
		clock,
		statusClock,
		frame,
		view: () => current,
		closes: () => closes,
		key: (value: string) => frame(() => stdin.send(value))
	}
}

test('full native TUI d reveals prior DEBUG; paused matching counts and source anchor survive arrivals', async t => {
	const f = fixture(t)
	await f.app.ready
	assert.match(f.stdout.text(), /ЖУРНАЛ · INFO\+ · LIVE/)
	assert.doesNotMatch(f.stdout.text(), /earlier retained DEBUG/)
	assert.match(await f.key('d'), /earlier retained DEBUG/)
	assert.equal(f.view().includeDebug, true)
	await f.key('d')
	const pausedFrame = await f.key('\u001b[A')
	const anchor = f.view().anchorId
	assert.equal(anchor, 'log:3')
	assert.match(pausedFrame, /PAUSED · \+0 новых/)
	const arrived = await f.frame(() => {
		f.append('new hidden DEBUG', 'debug')
		f.append('new INFO')
		f.append('new ERROR', 'error')
	})
	assert.equal(f.view().anchorId, anchor)
	assert.equal(f.view().newCount, 2)
	assert.match(arrived, /PAUSED · \+2 новых/)
	assert.doesNotMatch(arrived, /new INFO|new ERROR|new hidden DEBUG/)
	await f.key('d')
	assert.equal(f.view().newCount, 3)
	assert.equal(f.view().anchorId, anchor)
	assert.equal(f.view().mode, 'paused')
	await f.key('d')
	assert.equal(f.view().newCount, 2)
	const live = await f.key('\u001b[F')
	assert.match(live, /INFO\+ · LIVE/)
	assert.match(live, /new INFO/)
	assert.equal(f.view().newCount, 0)
	assert.equal(f.view().anchorId, null)
	assert.equal(f.counts().logSubscriptions, 1)
	assert.equal(f.counts().snapshotSubscriptions, 1)
})

test('paused real App log model retains its anchor/filter while status facts and elapsed time stay live', async t => {
	const f = fixture(t)
	await f.app.ready
	const harness = {
		mainActivity: 'TASKS.EXECUTING.MINING.BREAKING',
		enteredAt: 10000,
		action: 'mine_resource',
		monitoring: ['ENTITIES_MONITOR.RUNNING'],
		goal: { status: 'active' as const, text: 'Добудь камень' }
	}
	await f.frame(() => {
		f.publish({
			health: { value: 18, updatedAt: 10000, stale: false },
			maxHealth: { value: 30, updatedAt: 10000, stale: false },
			harness: { value: harness, updatedAt: 10000, stale: false }
		})
	})
	await f.key('d')
	await f.key('\u001b[A')
	const anchor = f.view().anchorId
	assert.equal(f.view().mode, 'paused')
	assert.equal(f.view().includeDebug, true)
	const arrived = await f.frame(() => {
		f.append('joint arriving DEBUG', 'debug')
		f.append('joint arriving INFO')
		f.publish({
			health: { value: 0, updatedAt: 11000, stale: false },
			position: { value: { x: 0, y: 0, z: 0 }, updatedAt: 11000, stale: false },
			harness: {
				value: { ...harness, monitoring: ['ENTITIES_MONITOR.RETRYING'] },
				updatedAt: 11000,
				stale: false
			}
		})
		f.statusClock.advance(1000)
	})
	assert.equal(f.view().mode, 'paused')
	assert.equal(f.view().anchorId, anchor)
	assert.equal(f.view().includeDebug, true)
	assert.equal(f.view().newCount, 2)
	assert.match(arrived, /DEBUG · PAUSED · \+2 новых/)
	assert.match(arrived, /HP: 0 \/ 30/)
	assert.match(arrived, /Сытость: — \/ 20/)
	assert.match(arrived, /ПОЗИЦИЯ: X 0 · Y 0 · Z 0/)
	assert.match(arrived, /Мониторинг: ENTITIES_MONITOR > RETRYING/)
	assert.match(arrived, /ЦЕЛЬ: В работе/)
	assert.match(arrived, /Время состояния: 00:01/)
	assert.doesNotMatch(arrived, /joint arriving/)
	const paused = f.view()
	const stable = f.runtime.telemetry.getSnapshot()
	const counts = f.counts()
	const timed = await f.frame(() => f.statusClock.advance(1000))
	assert.match(timed, /Время состояния: 00:02/)
	assert.equal(f.view(), paused)
	assert.equal(f.runtime.telemetry.getSnapshot(), stable)
	assert.equal(stable.harness.value?.enteredAt, 10000)
	assert.deepEqual(f.counts(), counts)
	assert.equal(counts.startCalls, 1)
	assert.equal(counts.snapshotSubscriptions, 1)
	assert.equal(counts.logSubscriptions, 1)
	assert.equal(f.statusClock.pending, 1)
	assert.equal(f.clock.pending, 0)
	const live = await f.key('\u001b[F')
	assert.match(live, /joint arriving INFO/)
	assert.match(live, /DEBUG · LIVE/)
	assert.equal(f.view().newCount, 0)
})

test('native arrows and PgUp/PgDn use terminal page capacity and return to latest explicitly', async t => {
	const f = fixture(t)
	await f.app.ready
	await f.frame(() => {
		for (let i = 0; i < 25; i++) f.append(`row ${i}`)
	})
	const history = f.runtime.telemetry.getLogHistory()
	const eligible = history.entries.filter(entry => entry.level !== 'debug')
	const latestFrame = f.stdout
		.text()
		.slice(f.stdout.text().lastIndexOf('VoxelPilot'))
	assert.equal(
		(latestFrame.match(/row \d+/g) ?? []).length,
		logPageSize(f.stdout.rows)
	)
	await f.key('\u001b[5~')
	const pageAnchor = eligible.at(-1 - logPageSize(f.stdout.rows))!.id
	assert.equal(f.view().anchorId, pageAnchor)
	await f.key('\u001b[A')
	assert.equal(
		f.view().anchorId,
		eligible.at(-2 - logPageSize(f.stdout.rows))!.id
	)
	await f.key('\u001b[B')
	assert.equal(f.view().anchorId, pageAnchor)
	assert.equal(f.view().mode, 'paused')
	await f.key('\u001b[6~')
	assert.equal(f.view().mode, 'live')
	assert.equal(f.view().entries.at(-1), eligible.at(-1))
})

test('full TUI eviction is visible, remains PAUSED and retains exact arrivals through tiny/resize/filter', async t => {
	const f = fixture(t)
	await f.app.ready
	await f.key('\u001b[5~')
	const original = f.view().anchorId
	const lost = await f.frame(() => {
		for (let i = 0; i < 40; i++)
			f.append(`bounded ${i}`, i % 2 ? 'info' : 'debug')
	})
	const source = f.runtime.telemetry.getLogHistory()
	assert.equal(source.entries.length, 32)
	assert.equal(source.stats.acceptedByLevel.info, 21)
	assert.equal(source.stats.evictedEntries, 12)
	assert.equal(f.view().newCount, 20)
	assert.equal(f.view().anchorLost, true)
	assert.notEqual(f.view().anchorId, original)
	assert.equal(
		f.view().anchorId,
		source.entries.find(entry => entry.level !== 'debug')!.id
	)
	assert.equal(f.view().mode, 'paused')
	assert.match(lost, /ЯКОРЬ УТРАЧЕН/)
	const paused = f.view()
	const tiny = await f.frame(() => f.stdout.resize(40, 6))
	assert.match(tiny, /q \/ Ctrl\+C/)
	assert.equal(f.view(), paused)
	await f.key('d')
	assert.equal(f.view().mode, 'paused')
	assert.equal(f.view().newCount, 40)
	await f.frame(() => f.stdout.resize(100, 24))
	assert.equal(f.view().mode, 'paused')
	assert.match(f.stdout.text(), /Увеличьте окно/)
	const beforeDuplicate = f.view()
	await f.frame(() => f.publishHistory(source))
	assert.equal(f.view(), beforeDuplicate)
	await f.frame(() =>
		f.publishHistory(
			Object.freeze({ ...source, revision: source.revision - 1 })
		)
	)
	assert.equal(f.view(), beforeDuplicate)
	const live = await f.key('\u001b[F')
	assert.equal(f.view().mode, 'live')
	assert.equal(f.view().anchorLost, false)
	assert.equal(f.view().evictedEntries, 12)
	assert.match(live, /Вытеснено: 12/)
	f.stdin.send('q')
	assert.equal((await f.app.done).exitCode, 0)
	assert.equal(f.counts().stopCalls, 1)
	assert.equal(f.closes(), 1)
	assert.equal(f.stdin.isRaw, false)
})

test('hidden DEBUG anchor preserves source ID through filter switches in actual TUI', async t => {
	const f = fixture(t)
	await f.app.ready
	await f.frame(() => {
		f.append('debug anchor', 'debug')
		f.append('latest INFO')
	})
	await f.key('d')
	await f.key('\u001b[A')
	const anchor = f.view().anchorId
	assert.equal(anchor, 'log:5')
	await f.key('d')
	assert.equal(f.view().anchorId, anchor)
	assert.equal(f.view().displayAnchorId, 'log:4')
	assert.equal(f.view().mode, 'paused')
	await f.key('d')
	assert.equal(f.view().displayAnchorId, anchor)
	assert.equal(f.view().mode, 'paused')
})

test('compact rows mark display shortening and source truncation separately without mutating source', async t => {
	const f = fixture(t)
	await f.app.ready
	const message = '界😀 '.repeat(100) + '\u001b]0;fixture\u0007\nnewline'
	const frame = await f.frame(() => f.append(message, 'warn', true))
	assert.match(frame, /… \[усечено\]/)
	assert.match(frame, /усечено: 1/)
	assert.equal(
		f.runtime.telemetry.getLogHistory().entries.at(-1)!.message,
		message
	)
	assert.equal(
		f.view().entries.at(-1),
		f.runtime.telemetry.getLogHistory().entries.at(-1)
	)
	assert.ok(!f.stdout.chunks.join('').includes('\u001b]0;fixture'))
	assert.equal(compactLogMessage('abcdef', 5, false), 'abcd…')
	assert.equal(compactLogMessage('abcdef', 3, true), '[!]')
	assert.equal(compactLogMessage('界😀abc', 6, false), '界😀a…')
	assert.match(compactLogMessage('ok\n\u001b', 40, false), /↵.*\\u001b/)
})

test('model and keys remain mounted through widget failure; paused Ctrl+C joins held save exactly once', async t => {
	const f = fixture(t, true)
	await f.app.ready
	assert.match(f.stdout.text(), /Log view unavailable/)
	await f.key('d')
	await f.key('\u001b[A')
	assert.equal(f.view().mode, 'paused')
	assert.equal(f.view().includeDebug, true)
	assert.equal(f.counts().stopCalls, 0)
	assert.doesNotMatch(f.stdout.text(), /private log widget/)
	const save = deferred<typeof saved>()
	f.holdStop(save.promise)
	f.stdin.send('\u0003')
	await f.stopStarted.promise
	f.signals.emit('SIGTERM')
	assert.equal(f.counts().stopCalls, 1)
	assert.equal(f.closes(), 0)
	assert.equal(f.stdin.isRaw, true)
	save.resolve(saved)
	assert.equal((await f.app.done).exitCode, 0)
	assert.equal(f.closes(), 1)
	assert.equal(f.stdin.isRaw, false)
})
