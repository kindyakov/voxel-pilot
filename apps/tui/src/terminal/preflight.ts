export interface TerminalStreams {
	readonly stdin: NodeJS.ReadStream
	readonly stdout: NodeJS.WriteStream
	readonly stderr: NodeJS.WriteStream
}

export function assertInteractiveTerminal(streams: TerminalStreams): void {
	if (
		!streams.stdin.isTTY ||
		!streams.stdout.isTTY ||
		typeof streams.stdin.setRawMode !== 'function'
	) {
		throw new Error(
			'TUI requires an interactive terminal with raw input. Run pnpm start for the headless CLI.'
		)
	}
}
