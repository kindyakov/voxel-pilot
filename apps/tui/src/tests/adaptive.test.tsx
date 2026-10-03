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
import {
	boundedDisplayLines,
	compactDisplayText,
	compactLogMessage
} from '../terminal/display.js'
import { terminalLayout } from '../terminal/layout.js'
import { logPageSize } from '../terminal/logNavigation.js'
import { ManualClock } from './fixtures/clock.js'
import { deferred, publicRuntime, saved } from './fixtures/runtime.js'
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
			const bounded = boundedDisplayLines(text, columns, 2, unicode)
			assert.equal(bounded.length, 2)
			for (const line of bounded) {
				assert.ok(stringWidth(line) <= columns)
				assert.doesNotMatch(line, /[\u0000-\u001f\u007f-\u009f]/)
			}
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
		headings.indexOf('HP') > headings.indexOf('ЖУРНАЛ'),
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

test('native expanded wide status follows the separated mockup hierarchy and bounded short-wide fallback', async t => {
	const f = fixture(t)
	await f.app.ready
	const path = 'TASKS.EXECUTING.MINING.BREAKING'
	const screen = await f.update(() => {
		f.publish({
			health: { value: 18, updatedAt: 1, stale: false },
			maxHealth: { value: 30, updatedAt: 1, stale: false },
			food: { value: 16, updatedAt: 1, stale: false },
			position: {
				value: { x: -124.25, y: 68, z: 317.5 },
				updatedAt: 1,
				stale: false
			},
			harness: {
				value: {
					mainActivity: path,
					enteredAt: 10000,
					action: 'mine_resource',
					monitoring: ['survival.safe', 'environment.day'],
					goal: { status: 'active', text: 'Добудь 20 блоков камня' }
				},
				updatedAt: 1,
				stale: false
			}
		})
		f.append('Actual native hierarchy record')
	})
	const lines = screen.split('\n')
	const hp = lines.findIndex(line => /HP\s+18\/30/.test(line))
	const food = lines.findIndex(line => /Сытость\s+16\/20/.test(line))
	assert.ok(
		hp >= 0,
		'wide HP label and actual numerator/maximum share a separate header'
	)
	assert.match(lines[hp + 1]!, /\[######----\]/)
	assert.ok(food >= hp + 3, 'vitals have breathing space')
	assert.match(lines[food + 1]!, /\[########--\]/)
	const position = lines.findIndex(line => /ПОЗИЦИЯ\s*│/.test(line))
	const hsm = lines.findIndex(line => /HSM\s*│/.test(line))
	const goal = lines.findIndex(line => /ЦЕЛЬ\s*│/.test(line))
	assert.ok(position > food + 1 && hsm > position + 1 && goal > hsm + 5)
	assert.match(lines[position + 1]!, /X -124\.25 · Y 68 · Z 317\.5/)
	assert.match(screen, /TASKS > EXECUTING > MINING > BREAKING/)
	assert.match(screen, /Время состояния: 00:25/)
	assert.match(screen, /Действие: mine_resource/)
	assert.match(screen, /Мониторинг: survival > safe/)
	assert.match(screen, /environment > day/)
	assert.match(lines[goal + 1]!, /Добудь 20 блоков камня/)
	assert.match(screen, /В работе/)
	assert.ok(
		lines.filter(line => /─{30}/.test(line)).length >= 5,
		'header, footer and status sections have actual rules'
	)
	const labelStart = lines[hp]!.indexOf('HP')
	assert.equal(
		lines[hp]!.indexOf('18/30') + 5,
		labelStart + f.props().layout.statusColumns
	)
	const short = await f.update(() => f.stdout.resize(120, 24))
	assert.match(short, /HP: 18 \/ 30/)
	assert.match(short, /ЦЕЛЬ: В работе/)
	assert.equal(f.counts().snapshotSubscriptions, 1)
	assert.equal(f.counts().logSubscriptions, 1)
	assert.equal(f.compositions(), 1)
	f.stdin.send('q')
	assert.equal((await f.app.done).exitCode, 0)
})

test('expanded native status retains full two-row paths and separate stale/paused/unknown facts', async t => {
	const f = fixture(t, { color: false, unicode: false })
	await f.app.ready
	const mainActivity = 'TASKS.EXECUTING.MINING.BREAKING'
	await f.update(() => f.stdout.resize(120, 36))
	const stale = await f.update(() =>
		f.publish({
			health: { value: 0, updatedAt: 1, stale: true },
			maxHealth: { value: 30, updatedAt: 1, stale: true },
			harness: {
				value: {
					mainActivity,
					enteredAt: 10000,
					action: 'safe action\nwith controls\u001b]0;not-executed\u0007',
					monitoring: ['survival.combat', 'environment.night'],
					goal: { status: 'paused', text: 'Сохранённая цель' }
				},
				updatedAt: 1,
				stale: true
			}
		})
	)
	assert.match(stale, /HP\s+0 \(устарело\)\/30 \(устарело\)/)
	assert.match(stale, /\[----------\]/)
	assert.match(stale, /Последний вход: 00:25 \| устарело/)
	assert.match(stale, /На паузе \| устарело/)
	assert.doesNotMatch(stale, /[┌┐└┘│─›↵…]/)
	assert.doesNotMatch(
		f.stdout.chunks.join(''),
		/\u001b\[[\d;]*m|\u001b\]0;not-executed/
	)
	const right = stale
		.split('\n')
		.filter(line => line.split('|').length >= 4)
		.map(line =>
			line
				.slice(
					line.indexOf('|', line.indexOf('|') + 1) + 1,
					line.lastIndexOf('|')
				)
				.trim()
		)
	assert.match(right.join(''), /TASKS > EXECUTING > MINING > BREAKING/)
	assert.equal(
		f.runtime.telemetry.getSnapshot().harness.value!.mainActivity,
		mainActivity
	)
	const unknown = await f.update(() =>
		f.publish({
			health: { value: null, updatedAt: null, stale: false },
			maxHealth: { value: null, updatedAt: null, stale: false },
			harness: { value: null, updatedAt: null, stale: false }
		})
	)
	assert.match(unknown, /HP\s+—\/—/)
	assert.match(unknown, /Время состояния: —/)
	assert.equal(f.compositions(), 1)
	f.stdin.send('\u0003')
	assert.equal((await f.app.done).exitCode, 0)
	assert.equal(f.stdin.isRaw, false)
})

test('routine READY reclaims two native rows while real reconnect and STOPPING context remain visible', async t => {
	const f = fixture(t)
	await f.app.ready
	const beforeReady = f.props().layout.logRows
	const ready = await f.update(() => {
		f.connection('ready')
		for (let i = 0; i < 32; i++) f.append(`ready capacity ${i}`)
	})
	assert.doesNotMatch(ready, /Runtime running|READY · attempt 0/)
	const lines = ready.split('\n')
	const header = lines.findIndex(line => line.includes('VoxelPilot'))
	assert.match(lines[header + 1]!, /─{30}/)
	assert.match(lines[header + 2]!, /ЖУРНАЛ/)
	assert.equal(f.props().layout.logRows, beforeReady + 2)
	for (const [columns, rows] of [
		[140, 36],
		[100, 24]
	]) {
		const screen = await f.update(() => {
			f.stdin.send('\u001b[F')
			f.stdout.resize(columns!, rows!)
		})
		const capacity = f.props().layout.logRows
		assert.equal((screen.match(/ready capacity \d+/g) ?? []).length, capacity)
		assert.equal(capacity, logPageSize(rows!, columns!, false, true))
		const history = f.runtime.telemetry.getLogHistory()
		await f.update(() => f.stdin.send('\u001b[5~'))
		assert.equal(
			f.props().logView.anchorId,
			history.entries.at(-1 - capacity)!.id
		)
	}
	const reconnect = await f.update(() => f.connection('reconnecting'))
	assert.match(reconnect, /RECONNECTING · attempt 0/)
	assert.equal(f.props().layout.logRows, logPageSize(24, 100))
	await f.update(() => f.connection('ready'))
	const save = deferred<typeof saved>()
	f.holdStop(save.promise)
	const stopping = await f.update(() => {
		void f.app.shutdown()
	})
	assert.match(stopping, /STOPPING/)
	assert.match(stopping, /Stopping.*awaiting persistence/)
	assert.equal(f.counts().stopCalls, 1)
	save.resolve(saved)
	assert.equal((await f.app.done).exitCode, 0)
	assert.equal(f.stdin.isRaw, false)
	assert.equal(f.compositions(), 1)
	assert.equal(f.counts().snapshotSubscriptions, 1)
	assert.equal(f.counts().logSubscriptions, 1)
})

test('tiny native STOPPING shows the trusted save/deadline message when rows fit and retains both exits', async t => {
	const f = fixture(t)
	await f.app.ready
	const save = deferred<typeof saved>()
	f.holdStop(save.promise)
	await f.update(() => f.stdout.resize(45, 12))
	const stopping = await f.update(() => {
		void f.app.shutdown()
	})
	assert.match(stopping, /STOPPING/)
	assert.match(stopping, /awaiting persistence/)
	assert.match(stopping, /deadline/)
	assert.match(stopping, /\b1s\b/)
	assert.match(stopping, /q \/ Ctrl\+C/)
	assert.equal(f.stdin.isRaw, true)
	const tiny = await f.update(() => f.stdout.resize(1, 1))
	assert.equal(tiny.trim(), 'q')
	const restored = await f.update(() => f.stdout.resize(45, 12))
	assert.match(restored, /awaiting persistence/)
	assert.match(restored, /deadline/)
	await f.update(() => {
		f.stdin.send('q')
		f.stdin.send('\u0003')
	})
	assert.equal(f.counts().stopCalls, 1)
	assert.equal(f.closes(), 0)
	save.resolve(saved)
	assert.equal((await f.app.done).exitCode, 0)
	assert.equal(f.stdin.isRaw, false)
	assert.equal(f.closes(), 1)
	assert.equal(f.compositions(), 1)
})
