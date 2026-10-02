import assert from 'node:assert/strict'
import test from 'node:test'

import { machine } from '../../hsm/machine.js'
import { buildHsmDrawioDiagram } from '../../hsm/utils/hsmDrawioDiagram.js'

const collectStatePaths = (
	states: Record<string, any> | undefined,
	path: string[] = []
): string[] => {
	if (!states) {
		return []
	}

	return Object.entries(states).flatMap(([name, config]) => {
		const currentPath = [...path, name]
		return [currentPath.join('.'), ...collectStatePaths(config.states, currentPath)]
	})
}

test('buildHsmDrawioDiagram includes every machine state exactly once in its manifest', () => {
	const diagram = buildHsmDrawioDiagram()
	const expectedPaths = collectStatePaths(machine.config.states).sort()

	assert.deepEqual([...diagram.statePaths].sort(), expectedPaths)
	assert.equal(new Set(diagram.statePaths).size, expectedPaths.length)
})

test('buildHsmDrawioDiagram emits mxGraphModel XML with key zones and animated flows', () => {
	const diagram = buildHsmDrawioDiagram()

	assert.match(diagram.xml, /^<mxGraphModel[\s>]/)
	assert.match(diagram.xml, /MAIN_ACTIVITY/)
	assert.match(diagram.xml, /MONITORING/)
	assert.match(diagram.xml, /URGENT_NEEDS/)
	assert.match(diagram.xml, /TASKS/)
	assert.match(diagram.xml, /COMBAT/)
	assert.match(diagram.xml, /flowAnimation=1/)

	assert.ok(
		diagram.animatedEdgeIds.includes('edge-agent-loop-thinking-executing'),
		'agent loop edge should be marked as animated'
	)
	assert.ok(
		diagram.animatedEdgeIds.includes('edge-combat-deciding-melee'),
		'combat melee edge should be marked as animated'
	)
	assert.ok(
		diagram.animatedEdgeIds.includes('edge-combat-deciding-ranged'),
		'combat ranged edge should be marked as animated'
	)
	assert.ok(
		diagram.animatedEdgeIds.includes('edge-mining-searching-checking-distance'),
		'mining loop edge should be marked as animated'
	)
})
