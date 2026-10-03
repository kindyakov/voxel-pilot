import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import test from 'node:test'
import { promisify } from 'node:util'

test('native Ink emits the soft palette and complete selected row only with color enabled', async () => {
	const environment: NodeJS.ProcessEnv = {
		...process.env,
		NODE_ENV: 'test',
		FORCE_COLOR: '3',
		TERM: 'xterm-256color',
		COLORTERM: 'truecolor',
		LANG: 'C.UTF-8'
	}
	delete environment.NO_COLOR
	for (const capability of ['color', 'limited']) {
		const result = await promisify(execFile)(
			process.execPath,
			[
				'--import',
				'../../packages/core/src/tests/setupEnv.mjs',
				'--import',
				'tsx',
				'src/tests/fixtures/colorFrame.tsx',
				capability
			],
			{ env: environment, timeout: 10000 }
		)
		assert.equal(result.stdout, '')
		// restore-cursor's exit hook writes this exact sequence to process.stderr.
		assert.ok(result.stderr === '' || result.stderr === '\u001b[?25h')
	}
})
