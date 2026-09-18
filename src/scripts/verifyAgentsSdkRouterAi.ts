import { performance } from 'node:perf_hooks'

import 'dotenv/config'

import {
	type AgentSdkEvent,
	type AgentSdkPilot,
	AgentSdkPilotError,
	type AgentSdkTool,
	createAgentsSdkPilot
} from '../ai/agentSdkPilot.js'

interface StreamMetrics {
	eventCount: number
	firstModelEventMs: number | null
	completedMs: number | null
	toolCalls: number
	toolResults: number
	totalMs: number
}

interface AbortMetrics {
	abortedErrorKind: AgentSdkPilotError['kind'] | null
	firstEvent: AgentSdkEvent['type'] | null
	totalMs: number
}

const roundMs = (value: number): number => Number(value.toFixed(1))

const redactBaseUrl = (baseUrl: string): string => {
	try {
		const url = new URL(baseUrl)
		url.username = ''
		url.password = ''
		for (const key of ['api_key', 'apiKey', 'key', 'token']) {
			if (url.searchParams.has(key)) url.searchParams.set(key, 'REDACTED')
		}
		return url.toString()
	} catch {
		return '<configured endpoint>'
	}
}

const parsePositiveInteger = (
	value: string | undefined
): number | undefined => {
	if (!value) return undefined
	const parsed = Number(value)
	return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined
}

const probeTool: AgentSdkTool = {
	name: 'agents_sdk_probe',
	description:
		'Return a fixed observation for an integration test; no game access.',
	strict: true,
	parameters: {
		type: 'object',
		properties: {
			target: { type: 'string' }
		},
		required: ['target'],
		additionalProperties: false
	},
	execute: args => {
		const target =
			args &&
			typeof args === 'object' &&
			typeof Reflect.get(args, 'target') === 'string'
				? Reflect.get(args, 'target')
				: 'unknown'
		return { ok: true, target }
	}
}

const consumeStream = async (
	pilot: AgentSdkPilot,
	input: string
): Promise<StreamMetrics> => {
	const startedAt = performance.now()
	let firstModelEventAt: number | undefined
	let completedAt: number | undefined
	let eventCount = 0
	let toolCalls = 0
	let toolResults = 0

	for await (const event of pilot.stream(input)) {
		eventCount += 1
		if (event.type === 'run_started') continue
		firstModelEventAt ??= performance.now()
		if (event.type === 'tool_call') toolCalls += 1
		if (event.type === 'tool_result') toolResults += 1
		if (event.type === 'completed') completedAt = performance.now()
	}

	return {
		eventCount,
		firstModelEventMs:
			firstModelEventAt === undefined
				? null
				: roundMs(firstModelEventAt - startedAt),
		completedMs:
			completedAt === undefined ? null : roundMs(completedAt - startedAt),
		toolCalls,
		toolResults,
		totalMs: roundMs(performance.now() - startedAt)
	}
}

const abortStream = async (
	pilot: AgentSdkPilot,
	input: string
): Promise<AbortMetrics> => {
	const startedAt = performance.now()
	const controller = new AbortController()
	const stream = pilot.stream(input, { signal: controller.signal })
	const first = await stream.next()
	controller.abort()

	let abortedErrorKind: AgentSdkPilotError['kind'] | null = null
	try {
		while (true) {
			const next = await stream.next()
			if (next.done) break
		}
	} catch (error) {
		if (!(error instanceof AgentSdkPilotError)) throw error
		abortedErrorKind = error.kind
	}

	return {
		abortedErrorKind,
		firstEvent: first.done ? null : first.value.type,
		totalMs: roundMs(performance.now() - startedAt)
	}
}

const main = async (): Promise<number> => {
	const apiKey = process.env.ROUTERAI_API_KEY ?? process.env.AI_API_KEY
	const baseUrl =
		process.env.ROUTERAI_BASE_URL ||
		process.env.AI_BASE_URL ||
		'https://routerai.ru/api/v1'
	const model = process.env.ROUTERAI_MODEL ?? process.env.AI_MODEL

	if (!apiKey || !model) {
		console.error(
			'Live RouterAI check requires ROUTERAI_API_KEY (or AI_API_KEY) and ROUTERAI_MODEL (or AI_MODEL).'
		)
		return 2
	}

	const pilot = createAgentsSdkPilot({
		apiKey,
		baseUrl,
		model,
		instructions:
			'You are running an integration check. For the first request, call agents_sdk_probe before answering. Keep responses concise.',
		timeoutMs: parsePositiveInteger(process.env.AI_TIMEOUT_MS),
		maxTokens: parsePositiveInteger(process.env.AI_MAX_TOKENS),
		maxTurns: 4,
		tools: [probeTool]
	})

	const firstInput =
		'Run the protocol check: call agents_sdk_probe with target oak, then briefly report the result.'
	const streamMetrics = await consumeStream(pilot, firstInput)
	if (streamMetrics.toolCalls === 0 || streamMetrics.toolResults === 0) {
		throw new Error(
			'RouterAI did not complete the required safe tool call in the streaming check.'
		)
	}

	const abortInput =
		'This request is intentionally interrupted. Start a concise response and keep the conversation history.'
	const abortMetrics = await abortStream(pilot, abortInput)
	if (abortMetrics.abortedErrorKind !== 'aborted') {
		throw new Error(
			`Expected an aborted stream, received ${abortMetrics.abortedErrorKind ?? 'a completed stream'}.`
		)
	}

	const continuationInput =
		'Continue after the interrupted response in one short sentence.'
	const continuationStartedAt = performance.now()
	const continuation = await pilot.run(continuationInput)
	const history = pilot.history()
	const historyHasInterruptedInput = history.some(
		item => item.role === 'user' && item.content === abortInput
	)
	if (!historyHasInterruptedInput) {
		throw new Error('The interrupted user message was not retained in history.')
	}

	console.log(
		JSON.stringify(
			{
				provider: 'routerai',
				baseUrl: redactBaseUrl(baseUrl),
				model,
				stream: streamMetrics,
				abort: abortMetrics,
				continuation: {
					elapsedMs: roundMs(performance.now() - continuationStartedAt),
					outputText: continuation.outputText
				},
				historyEntries: history.length,
				historyHasInterruptedInput
			},
			null,
			2
		)
	)
	return 0
}

try {
	const exitCode = await main()
	process.exitCode = exitCode
} catch (error) {
	console.error(error instanceof Error ? error.message : String(error))
	process.exitCode = 1
}
