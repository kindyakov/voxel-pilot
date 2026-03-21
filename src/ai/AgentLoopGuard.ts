export interface AgentLoopFailure {
	toolName: string
	args: Record<string, unknown>
	reason: string
}

export interface AgentLoopGuardOptions {
	maxRepeats: number
}

export interface AgentLoopGuardResult {
	shouldAbort: boolean
	repeats: number
	signature: string
}

const stableStringify = (value: unknown): string => {
	if (value === null || typeof value !== 'object') {
		return JSON.stringify(value)
	}

	if (Array.isArray(value)) {
		return `[${value.map(stableStringify).join(',')}]`
	}

	const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
		left.localeCompare(right)
	)

	return `{${entries
		.map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`)
		.join(',')}}`
}

export class AgentLoopGuard {
	private readonly maxRepeats: number
	private lastSignature: string | null = null
	private repeats: number = 0

	constructor(options: AgentLoopGuardOptions) {
		this.maxRepeats = options.maxRepeats
	}

	recordFailure(input: AgentLoopFailure): AgentLoopGuardResult {
		const signature = `${input.toolName}:${stableStringify(input.args)}:${input.reason}`

		if (this.lastSignature === signature) {
			this.repeats += 1
		} else {
			this.lastSignature = signature
			this.repeats = 1
		}

		return {
			shouldAbort: this.repeats >= this.maxRepeats,
			repeats: this.repeats,
			signature
		}
	}

	recordSuccess(): void {
		this.reset()
	}

	reset(): void {
		this.lastSignature = null
		this.repeats = 0
	}
}
