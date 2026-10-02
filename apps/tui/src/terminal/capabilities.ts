export interface TerminalCapabilities {
	readonly color: boolean
	readonly unicode: boolean
}

export interface TerminalEnvironment {
	readonly TERM?: string
	readonly COLORTERM?: string
	readonly NO_COLOR?: string
	readonly FORCE_COLOR?: string
	readonly LANG?: string
	readonly LC_ALL?: string
	readonly LC_CTYPE?: string
}

/** Called after TTY preflight with explicit hints; module import reads nothing. */
export function terminalCapabilities(
	output: Pick<NodeJS.WriteStream, 'isTTY' | 'getColorDepth'>,
	environment: TerminalEnvironment
): TerminalCapabilities {
	const disabled =
		!output.isTTY ||
		environment.TERM === 'dumb' ||
		environment.NO_COLOR !== undefined ||
		environment.FORCE_COLOR === '0'
	let depth = 1
	if (!disabled) {
		try {
			depth = output.getColorDepth?.({ ...environment }) ?? 1
		} catch {}
	}
	const limited = environment.TERM === 'dumb' || environment.TERM === 'linux'
	const locale = environment.LC_ALL || environment.LC_CTYPE || environment.LANG
	const forced =
		environment.FORCE_COLOR !== undefined &&
		['', '1', 'true', '2', '3'].includes(environment.FORCE_COLOR)
	const color = !disabled && (depth >= 4 || forced)
	return Object.freeze({
		color,
		unicode: !limited && (!locale || /utf-?8/i.test(locale))
	})
}

export const asciiBorder = Object.freeze({
	topLeft: '+',
	topRight: '+',
	bottomLeft: '+',
	bottomRight: '+',
	top: '-',
	bottom: '-',
	left: '|',
	right: '|'
})
