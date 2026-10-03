import assert from 'node:assert/strict'
import { setImmediate as flushEffects } from 'node:timers/promises'
import { stripVTControlCharacters } from 'node:util'

import stringWidth from 'string-width'

import { Dashboard, type DashboardProps } from '../../app/App.js'
import { startTuiApplication } from '../../app/application.js'
import { ManualClock } from './clock.js'
import { publicRuntime } from './runtime.js'
import { ManualStatusClock } from './statusClock.js'
import { Input, Output } from './terminal.js'

const colored = process.argv[2] === 'color'
const source = publicRuntime()
const stdin = new Input(),
	stdout = new Output(),
	stderr = new Output()
stdout.columns = 140
stdout.rows = 40
const clock = new ManualClock()
const statusClock = new ManualStatusClock(35000)
function backgroundCells(line: string): readonly string[] {
	let background = ''
	const cells: string[] = []
	for (const segment of line.split(/(\u001b\[[\d;]*m)/)) {
		if (/^\u001b\[[\d;]*m$/.test(segment)) {
			const codes = segment.slice(2, -1).split(';').map(Number)
			for (let i = 0; i < codes.length; i++) {
				if (codes[i] === 0 || codes[i] === 49) background = ''
				if (codes[i] === 48 && codes[i + 1] === 2) {
					background = codes.slice(i + 2, i + 5).join(';')
					i += 4
				}
			}
		} else cells.push(...Array<string>(stringWidth(segment)).fill(background))
	}
	return cells
}
function checkWholeFrame(raw: string) {
	const lines = raw.trimEnd().split('\n')
	assert.equal(lines.length, stdout.rows)
	for (const line of lines) {
		assert.equal(stringWidth(line), stdout.columns)
		if (colored) {
			const cells = backgroundCells(line)
			assert.equal(cells.length, stdout.columns)
			assert.ok(
				cells.every(value => value === '17;19;24' || value === '36;40;51'),
				'every native frame cell, including outer borders, has the explicit dark or selection background'
			)
		} else assert.doesNotMatch(line, /\u001b\[[\d;]*m/)
	}
}
let props!: DashboardProps
const app = startTuiApplication({
	streams: { stdin, stdout, stderr },
	signals: source.signals,
	clock,
	statusClock,
	capabilities: { color: colored, unicode: true },
	displayClock: { formatTimestamp: () => '12:34:56' },
	compose: () => ({
		runtime: source.runtime,
		loggerHandle: { async close() {} }
	}),
	view(value) {
		props = value
		return <Dashboard {...value} />
	}
})
try {
	await app.ready
	source.connection('ready')
	source.publish({
		health: { value: 18, updatedAt: 1, stale: false },
		maxHealth: { value: 30, updatedAt: 1, stale: false },
		food: { value: 16, updatedAt: 1, stale: false }
	})
	source.append('selected retained native row')
	source.append('latest native row')
	await flushEffects()
	await app.flush()
	stdin.send('\u001b[A')
	await flushEffects()
	await app.flush()
	await flushEffects()
	const raw = [...stdout.chunks]
		.reverse()
		.find(chunk => chunk.includes('selected retained native row'))!
	const plain = stripVTControlCharacters(raw)
	assert.match(
		plain,
		/› 12:34:56\s{3}INFO\s{4}CORE\s{11}selected retained native row/
	)
	assert.equal(props.logView.mode, 'paused')
	const selected = raw
		.split('\n')
		.find(line => line.includes('selected retained native row'))!
	checkWholeFrame(raw)
	if (colored) {
		for (const rgb of [
			'255;91;127',
			'74;222;128',
			'133;138;159',
			'83;89;102',
			'230;230;240'
		])
			assert.ok(
				raw.includes(`\u001b[38;2;${rgb}m`),
				`native frame must use exact ${rgb} foreground`
			)
		assert.match(raw, /\u001b\[1m/)
		const selectedCells = backgroundCells(selected).filter(
			value => value === '36;40;51'
		).length
		assert.equal(
			selectedCells,
			props.layout.logColumns,
			'selection colors every cell of the record row, including padding'
		)
	} else assert.doesNotMatch(raw, /\u001b\[[\d;]*m/)
	for (const [columns, rows] of [
		[80, 24],
		[48, 12],
		[1, 1],
		[140, 40]
	]) {
		stdout.resize(columns!, rows!)
		await flushEffects()
		await app.flush()
		await flushEffects()
		checkWholeFrame(
			[...stdout.chunks]
				.reverse()
				.find(chunk => stripVTControlCharacters(chunk).trim())!
		)
	}
	assert.equal(source.counts().snapshotSubscriptions, 1)
	assert.equal(source.counts().logSubscriptions, 1)
	stdin.send('q')
	assert.equal((await app.done).exitCode, 0)
	assert.equal(stdin.isRaw, false)
} finally {
	void app.shutdown()
	clock.advance(15000)
	stdout.release()
	await app.done
	await flushEffects()
	assert.equal(statusClock.pending, 0)
	assert.equal(source.counts().activeSnapshots + source.counts().activeLogs, 0)
	stdin.destroy()
	stdout.destroy()
	stderr.destroy()
}
