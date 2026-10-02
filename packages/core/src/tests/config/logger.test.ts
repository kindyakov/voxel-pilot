import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { createRuntimeLogger } from '../../config/runtimeLogger.js'

const ESC = String.fromCharCode(27)

test('console transport emits ANSI colors for every level and caps meta preview', async () => {
	const directory = await mkdtemp(
		path.join(os.tmpdir(), 'voxel-logger-console-')
	)
	const handle = createRuntimeLogger({
		aiModel: 'logger-test-model',
		console: { level: 'debug', colors: true },
		files: {
			logFile: path.join(directory, 'voxel-pilot-logger-test.log'),
			errorLogFile: path.join(directory, 'error.log'),
			level: 'debug',
			maxBytes: 100000,
			maxFiles: 2
		}
	})
	const Logger = handle.logger

	const chunks: Buffer[] = []
	const origOut = process.stdout.write.bind(process.stdout)
	const origErr = process.stderr.write.bind(process.stderr)
	const capture = (chunk: unknown): boolean => {
		chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)))
		return true
	}

	try {
		;(process.stdout as unknown as { write: unknown }).write = capture
		;(process.stderr as unknown as { write: unknown }).write = capture

		Logger.setCorrelationId('TEST')
		Logger.debug('logger-test-debug')
		Logger.info('logger-test-info', { answer: 42 })
		Logger.warn('logger-test-warn')
		Logger.error('logger-test-error')
		const wide: Record<string, string> = {}
		for (let i = 0; i < 40; i++) {
			wide[`field_${i}_with_long_name`] = `value-${i}-`.repeat(12)
		}
		Logger.info('logger-test-huge', {
			candidates: Array.from({ length: 50 }, (_, id) => ({
				id,
				name: `candidate-${id}-with-a-long-name`,
				distance: 42.5,
				reason: 'outside_engagement_range'
			})),
			...wide
		})

		await handle.close()
	} finally {
		process.stdout.write = origOut
		process.stderr.write = origErr
		await handle.close()
		await rm(directory, { recursive: true, force: true })
	}

	const out = Buffer.concat(chunks).toString('utf8')
	for (const level of ['DEBUG', 'INFO', 'WARN', 'ERROR']) {
		const index = out.indexOf(level)
		assert.ok(index >= 0, `expected [${level}] line in console output`)
		assert.ok(
			out
				.slice(Math.max(0, index - 16), index + level.length + 8)
				.includes(`${ESC}[`),
			`expected ANSI color before [${level}]`
		)
	}

	const hugeLine = out
		.split('\n')
		.find(line => line.includes('logger-test-huge'))
	assert.ok(hugeLine, 'expected the huge-meta line in console output')
	assert.ok(!hugeLine.includes('\n'), 'expected single-line console preview')
	assert.ok(
		hugeLine.length <= 2600,
		`expected capped console preview, got ${hugeLine.length} chars`
	)
	assert.match(
		hugeLine,
		/full in .*voxel-pilot-logger-test\.log/,
		'expected overflow marker with log file path'
	)

	const infoLine = out
		.split('\n')
		.find(line => line.includes('logger-test-info'))
	assert.ok(infoLine?.includes('42'), 'expected small meta to stay intact')
})
