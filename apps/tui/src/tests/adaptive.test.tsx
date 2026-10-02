import assert from 'node:assert/strict'
import test from 'node:test'
import { setImmediate as flushEffects } from 'node:timers/promises'
import { stripVTControlCharacters } from 'node:util'

import stringWidth from 'string-width'

import { Dashboard, type DashboardProps } from '../app/App.js'
import { startTuiApplication } from '../app/application.js'
import {
	type TerminalCapabilities,
	terminalCapabilities
} from '../terminal/capabilities.js'
import { compactDisplayText, compactLogMessage } from '../terminal/display.js'
import { terminalLayout } from '../terminal/layout.js'
import { logPageSize } from '../terminal/logNavigation.js'
import { ManualClock } from './fixtures/clock.js'
import { publicRuntime } from './fixtures/runtime.js'
import { ManualStatusClock } from './fixtures/statusClock.js'
import { Input, Output } from './fixtures/terminal.js'

test('one terminal budget accounts for panes, failure, real record rows and page keys', () => {
	for (const [columns, rows] of [
		[140, 36],
		[120, 24],
		[100, 24],
		[70, 26],
		[50, 20],
		[35, 6],
		[1, 1]
	]) {
		for (const failure of [false, true]) {
			const layout = terminalLayout(columns!, rows!, failure)
			assert.equal(layout.logRows, logPageSize(rows!, columns!, failure))
			assert.ok(layout.logRows >= 1)
			if (layout.mode === 'wide') {
				assert.equal(layout.logColumns + layout.statusColumns + 3, columns! - 4)
				assert.ok(Math.abs(layout.logColumns / (columns! - 7) - 0.65) < 0.01)
				assert.equal(layout.logRows + 3, layout.contentRows)
			} else if (layout.mode === 'narrow') {
				assert.equal(layout.logRows + 3 + 11, layout.contentRows)
				assert.equal(layout.statusColumns, columns! - 4)
			}
		}
	}
	assert.equal(terminalLayout(120, 24).mode, 'wide')
	assert.equal(terminalLayout(100, 24).mode, 'narrow')
	assert.equal(terminalLayout(35, 6).mode, 'tiny')
	assert.equal(terminalLayout(50, 20, true).mode, 'tiny')
	assert.equal(terminalLayout(Number.NaN, Infinity).columns, 80)
})

test('capabilities use explicit TTY/color/locale hints with limited and failing streams', () => {
	const output = { isTTY: true, getColorDepth: () => 8 }
	assert.deepEqual(
		terminalCapabilities(output, { TERM: 'xterm-256color', LANG: 'C.UTF-8' }),
		{ color: true, unicode: true }
	)
	assert.deepEqual(
		terminalCapabilities(output, { TERM: 'linux', LANG: 'C', NO_COLOR: '1' }),
		{ color: false, unicode: false }
	)
	assert.deepEqual(
		terminalCapabilities(output, { TERM: 'dumb', FORCE_COLOR: '3' }),
		{ color: false, unicode: false }
	)
	assert.equal(terminalCapabilities(output, { NO_COLOR: '' }).color, false)
	assert.equal(terminalCapabilities(output, { FORCE_COLOR: '0' }).color, false)
	assert.equal(
		terminalCapabilities({ ...output, isTTY: false }, {}).color,
		false
	)
	assert.equal(
		terminalCapabilities(
			{ ...output, getColorDepth: () => 1 },
			{ FORCE_COLOR: '1' }
		).color,
		true
	)
	assert.equal(
		terminalCapabilities(
			{
				...output,
				getColorDepth() {
					throw new Error('private capability failure')
				}
			},
			{}
		).color,
		false
	)
	assert.equal(
		terminalCapabilities(output, { LANG: 'C', LC_ALL: 'ru_RU.UTF8' }).unicode,
		true
	)
	assert.equal(
		terminalCapabilities(
			{ ...output, getColorDepth: () => 1 },
			{ FORCE_COLOR: 'false' }
		).color,
		false
	)
	assert.equal(
		terminalCapabilities(
			{ ...output, getColorDepth: () => 1 },
			{ FORCE_COLOR: '' }
		).color,
		true
	)
	let calls = 0
	assert.equal(
		terminalCapabilities(
			{
				...output,
				getColorDepth() {
					calls++
					return 8
				}
			},
			{ NO_COLOR: '1', FORCE_COLOR: '1' }
		).color,
		false
	)
	assert.equal(
		calls,
		0,
		'disabled styling must not invoke Node conflicting-hint warning path'
	)
})

test('cell clipping handles Cyrillic, combining characters, emoji, controls and separate source markers', () => {
	const text =
		'Кириллица 😀 界 e\u0301 👩‍💻 ' +
		'длинная строка '.repeat(20) +
		'\n\u001b]0;unsafe\u0007'
	for (let columns = 1; columns < 90; columns++) {
		for (const unicode of [true, false]) {
			const plain = compactDisplayText(text, columns, unicode)
			const truncated = compactLogMessage(text, columns, true, unicode)
			assert.ok(
				stringWidth(plain) <= columns,
				`display must fit ${columns} cells`
			)
			assert.ok(
				stringWidth(truncated) <= columns,
				`record must fit ${columns} cells`
			)
			assert.doesNotMatch(plain + truncated, /[\u0000-\u001f\u007f-\u009f]/)
			assert.ok(
				truncated.endsWith(
					columns >= 10 ? '[усечено]' : columns >= 3 ? '[!]' : '!'
				)
			)
		}
	}
})

function fixture(
	t: test.TestContext,
	capabilities: TerminalCapabilities = { color: false, unicode: true }
) {
	const source = publicRuntime()
	const stdin = new Input(),
		stdout = new Output(),
		stderr = new Output()
	stdout.columns = 140
	stdout.rows = 36
	const clock = new ManualClock()
	const statusClock = new ManualStatusClock(35000)
	let compositions = 0,
		closes = 0
	let props!: DashboardProps
	const app = startTuiApplication({
		streams: { stdin, stdout, stderr },
		signals: source.signals,
		clock,
		statusClock,
		capabilities,
		shutdownTimeoutMs: 1000,
		displayClock: { formatTimestamp: () => '12:34:56' },
		compose() {
			compositions++
			return {
				runtime: source.runtime,
				loggerHandle: {
					async close() {
						closes++
					}
				}
			}
		},
		view(value) {
			props = value
			return <Dashboard {...value} />
		}
	})
	t.after(async () => {
		void app.shutdown()
		clock.advance(1000)
		stdout.release()
		await app.done
		await flushEffects()
		assert.equal(statusClock.pending, 0)
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
	const frame = () => {
		const text = [...stdout.chunks]
			.reverse()
			.map(stripVTControlCharacters)
			.find(chunk => chunk.trim())!
		const header = text.lastIndexOf('VoxelPilot')
		return (
			header < 0 ? text : text.slice(text.lastIndexOf('\n', header) + 1)
		).trimEnd()
	}
	const update = async (action: () => void) => {
		action()
		await flushEffects()
		await app.flush()
		await flushEffects()
		const current = frame()
		const lines = current.split('\n')
		assert.ok(
			lines.length <= stdout.rows,
			`${lines.length} lines exceed ${stdout.rows}`
		)
		for (const line of lines)
			assert.ok(
				stringWidth(line) <= stdout.columns,
				`frame exceeds ${stdout.columns} cells: ${line}`
			)
		return current
	}
	return {
		...source,
		app,
		stdin,
		stdout,
		stderr,
		statusClock,
		clock,
		frame,
		update,
		props: () => props,
		compositions: () => compositions,
		closes: () => closes
	}
}

test('real same-App wide/narrow/tiny/restored geometry retains opaque pause/filter, exact arrivals and timer', async t => {
	const f = fixture(t)
	await f.app.ready
	const harness = {
		mainActivity: 'TASKS.EXECUTING.MINING.BREAKING',
		enteredAt: 10000,
		action: 'mine_resource',
		monitoring: ['ENTITIES_MONITOR.RUNNING'],
		goal: { status: 'active' as const, text: 'Добудь 20 блоков камня' }
	}
	const initial = await f.update(() => {
		f.publish({ harness: { value: harness, updatedAt: 35000, stale: false } })
		for (let i = 0; i < 32; i++)
			f.append(`adaptive row ${i}`, i % 3 ? 'info' : 'debug')
	})
	assert.equal(f.props().layout.mode, 'wide')
	const headings = initial.split('\n').find(line => line.includes('ЖУРНАЛ'))!
	assert.ok(
		headings.indexOf('СТАТУС') > headings.indexOf('ЖУРНАЛ'),
		'wide panes share their actual heading row'
	)
	await f.update(() => f.stdin.send('d'))
	await f.update(() => f.stdin.send('\u001b[A'))
	const anchor = f.props().logView.anchorId
	const paused = f.props().logView
	const narrow = await f.update(() => f.stdout.resize(70, 26))
	assert.equal(f.props().layout.mode, 'narrow')
	assert.equal(f.props().logView, paused)
	assert.ok(narrow.indexOf('СТАТУС') < narrow.indexOf('ЖУРНАЛ'))
	assert.match(narrow, /Время состояния: 00:25/)
	assert.match(narrow, /DEBUG · PAUSED · \+0 новых/)
	const tiny = await f.update(() => f.stdout.resize(35, 6))
	assert.match(tiny, /Увеличьте окно/)
	assert.match(tiny, /q \/ Ctrl\+C/)
	assert.equal(f.props().logView, paused)
	assert.equal(f.statusClock.pending, 0)
	await f.update(() => {
		f.append('arrival while tiny', 'info')
		f.append('DEBUG while tiny', 'debug')
		f.statusClock.advance(10000)
	})
	assert.equal(f.props().logView.anchorId, anchor)
	assert.equal(f.props().logView.newCount, 2)
	const restored = await f.update(() => f.stdout.resize(140, 36))
	assert.equal(f.props().logView.anchorId, anchor)
	assert.equal(f.props().logView.includeDebug, true)
	assert.match(restored, /PAUSED · \+2 новых/)
	assert.match(restored, /Время состояния: 00:35/)
	assert.doesNotMatch(restored, /arrival while tiny|DEBUG while tiny/)
	assert.equal(f.compositions(), 1)
	assert.equal(f.counts().startCalls, 1)
	assert.equal(f.counts().snapshotSubscriptions, 1)
	assert.equal(f.counts().logSubscriptions, 1)
	const live = await f.update(() => f.stdin.send('\u001b[F'))
	assert.match(live, /arrival while tiny/)
	assert.equal(f.props().logView.mode, 'live')
	f.stdin.send('q')
	assert.equal((await f.app.done).exitCode, 0)
	assert.equal(f.closes(), 1)
	assert.equal(f.counts().stopCalls, 1)
	assert.equal(f.stdin.isRaw, false)
})

test('actual wide and narrow page navigation equals visible records, including retained final failure', async t => {
	const f = fixture(t)
	await f.app.ready
	await f.update(() => {
		for (let i = 0; i < 32; i++) f.append(`capacity row ${i}`)
	})
	for (const [columns, rows] of [
		[140, 36],
		[70, 26]
	]) {
		await f.update(() => {
			f.stdin.send('\u001b[F')
			f.stdout.resize(columns!, rows!)
		})
		const expected = f.props().layout.logRows
		assert.equal((f.frame().match(/capacity row \d+/g) ?? []).length, expected)
		const history = f.runtime.telemetry.getLogHistory()
		await f.update(() => f.stdin.send('\u001b[5~'))
		assert.equal(
			f.props().logView.anchorId,
			history.entries.at(-1 - expected)!.id
		)
		await f.update(() => f.stdin.send('\u001b[6~'))
		assert.equal(f.props().logView.mode, 'live')
	}
	const failed = await f.update(() =>
		f.connection('failed', {
			code: 'fixture',
			message: 'Final native fixture failure'
		})
	)
	assert.match(failed, /Final native fixture failure/)
	assert.equal(
		(failed.match(/capacity row \d+/g) ?? []).length,
		f.props().layout.logRows
	)
	assert.equal(f.counts().stopCalls, 0)
	const history = f.runtime.telemetry.getLogHistory()
	await f.update(() => f.stdin.send('\u001b[5~'))
	assert.equal(
		f.props().logView.anchorId,
		history.entries.at(-1 - f.props().layout.logRows)!.id
	)
	await f.update(() => f.stdout.resize(35, 6))
	assert.match(f.frame(), /Final native fixture failure/)
	f.stdin.send('\u0003')
	assert.equal((await f.app.done).exitCode, 1)
	assert.equal(f.closes(), 1)
	assert.equal(f.stdin.isRaw, false)
})

test('limited native display uses ASCII decorations and no SGR while preserving paused/unknown/stale semantics', async t => {
	const f = fixture(t, { color: false, unicode: false })
	await f.app.ready
	await f.update(() => f.stdout.resize(100, 24))
	const message = 'длинная 😀 界 '.repeat(80) + '\n\u001b]0;unsafe\u0007'
	const text = await f.update(() => {
		f.append(message, 'warn', true)
		f.publish({
			health: { value: 0, updatedAt: 1, stale: true },
			harness: {
				value: {
					mainActivity: 'IDLE',
					enteredAt: 10000,
					action: null,
					monitoring: [],
					goal: { status: 'paused', text: 'Сохранённая цель' }
				},
				updatedAt: 1,
				stale: true
			}
		})
	})
	assert.match(text, /HP: 0 \(устарело\) \/ —/)
	assert.match(text, /ЦЕЛЬ: На паузе \| устарело/)
	assert.match(text, /От входа в последнее состояние: 00:25 \| устарело/)
	assert.match(text, /~ \[усечено\]/)
	assert.doesNotMatch(text, /[┌┐└┘│─›↵…]/)
	assert.doesNotMatch(
		f.stdout.chunks.join(''),
		/\u001b\[[\d;]*m|\u001b\]0;unsafe/
	)
	assert.equal(
		f.runtime.telemetry.getLogHistory().entries.at(-1)!.message,
		message
	)
	await f.update(() => {
		f.append('another record')
		f.stdin.send('\u001b[A')
	})
	assert.match(f.frame(), /INFO\+ \| PAUSED/)
	assert.match(f.frame(), /> 12:34:56 WARN/)
	f.stdin.send('q')
	assert.equal((await f.app.done).exitCode, 0)
})

test('very small native frames reserve available cells for exit and restore the same model', async t => {
	const f = fixture(t)
	await f.app.ready
	await f.update(() => {
		f.append('stable source')
		f.stdin.send('\u001b[A')
	})
	const paused = f.props().logView
	for (const [columns, rows] of [
		[35, 6],
		[20, 4],
		[4, 3],
		[1, 1]
	]) {
		await f.update(() => f.stdout.resize(columns!, rows!))
		assert.equal(f.props().logView, paused)
		assert.equal(f.props().layout.mode, 'tiny')
		assert.equal(f.counts().stopCalls, 0)
		assert.ok(f.stdin.isRaw)
	}
	await f.update(() => f.stdout.resize(100, 24))
	assert.equal(f.props().logView, paused)
	assert.equal(f.compositions(), 1)
	f.stdin.send('\u0003')
	assert.equal((await f.app.done).exitCode, 0)
	assert.equal(f.stdin.isRaw, false)
})
