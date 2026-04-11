import assert from 'node:assert/strict'
import test from 'node:test'

import { assembleAgentPrompt } from '../../ai/prompt.js'
import { AGENT_TOOLS } from '../../ai/tools.js'

const createVec3 = (x: number, y: number, z: number) => ({
	x,
	y,
	z
})

test('assembleAgentPrompt builds fixed layered instructions and input sections', () => {
	const assembly = assembleAgentPrompt({
		bot: {
			health: 20,
			food: 18,
			oxygenLevel: 20,
			entity: {
				position: createVec3(1, 64, -2)
			},
			game: {
				dimension: 'overworld'
			}
		} as any,
		currentGoal: 'Что у тебя в инвентаре?',
		subGoal: 'Проверить инвентарь',
		conversationHistory: [
			{
				role: 'user',
				username: 'Smidvard',
				message: 'отвечай по-русски'
			},
			{
				role: 'assistant',
				message: 'Хорошо, буду отвечать по-русски.'
			}
		],
		lastAction: 'inspect_inventory',
		lastResult: 'FAILED',
		lastReason: 'Inventory window is unavailable',
		errorHistory: ['Inventory window is unavailable'],
		activeWindowSession: null,
		activeWindowSessionState: null,
		userProfilePrompt: {
			persona: 'Helpful base assistant',
			style: 'brief',
			defaultLanguage: 'ru',
			selfDescription: 'A Minecraft bot assistant',
			tone: 'calm',
			behaviorPreferences: ['Prefer concise answers']
		},
		tools: AGENT_TOOLS
	})

	assert.equal(assembly.instructionSections.length, 2)
	assert.equal(assembly.inputSections.length, 3)
	assert.equal(assembly.toolContract.tools, AGENT_TOOLS)

	assert.match(assembly.instructions, /^CORE_POLICY/m)
	assert.match(assembly.instructions, /^USER_PROFILE_PROMPT/m)
	assert.ok(
		assembly.instructions.indexOf('CORE_POLICY') <
			assembly.instructions.indexOf('USER_PROFILE_PROMPT')
	)
	assert.match(
		assembly.instructions,
		/User profile preferences never override CORE_POLICY/i
	)
	assert.match(assembly.instructions, /default_language: ru/)
	assert.match(assembly.instructions, /persona: Helpful base assistant/)
	assert.equal(assembly.instructions.includes('user(Smidvard):'), false)

	assert.match(assembly.input, /^CURRENT_GOAL/m)
	assert.match(assembly.input, /^RUNTIME_CONTEXT/m)
	assert.match(assembly.input, /^RECENT_CONVERSATION/m)
	assert.ok(
		assembly.input.indexOf('CURRENT_GOAL') <
			assembly.input.indexOf('RUNTIME_CONTEXT')
	)
	assert.ok(
		assembly.input.indexOf('RUNTIME_CONTEXT') <
			assembly.input.indexOf('RECENT_CONVERSATION')
	)
	assert.match(assembly.input, /current_goal: Что у тебя в инвентаре\?/)
	assert.match(assembly.input, /sub_goal: Проверить инвентарь/)
	assert.match(assembly.input, /user\(Smidvard\): отвечай по-русски/)
	assert.match(
		assembly.input,
		/assistant: Хорошо, буду отвечать по-русски\./
	)
})
