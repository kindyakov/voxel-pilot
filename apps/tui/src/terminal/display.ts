import cliTruncate from 'cli-truncate'

/** Plain single-line text, including defensive handling of injected public fixtures. */
export function safeDisplayText(value: string): string {
	return value.replace(/[\u0000-\u001f\u007f-\u009f]/g, control => {
		if (control === '\n') return ' ↵ '
		if (control === '\t') return ' '
		return `\\u${control.charCodeAt(0).toString(16).padStart(4, '0')}`
	})
}

function displayText(value: string, unicode: boolean): string {
	const text = safeDisplayText(value)
	return unicode
		? text
		: text.replaceAll(' · ', ' | ').replaceAll(' ↵ ', ' \\n ')
}

/** Display ellipsis and source truncation are separate, visible facts. */
export function compactLogMessage(
	message: string,
	columns: number,
	sourceTruncated: boolean,
	unicode = true
): string {
	const marker = !sourceTruncated
		? ''
		: columns >= 10
			? ' [усечено]'
			: columns >= 3
				? '[!]'
				: columns >= 1
					? '!'
					: ''
	return (
		cliTruncate(
			displayText(message, unicode),
			Math.max(0, columns - marker.length),
			{ truncationCharacter: unicode ? '…' : '~' }
		) + marker
	)
}

export function compactDisplayText(
	value: string,
	columns: number,
	unicode = true
): string {
	return cliTruncate(displayText(value, unicode), Math.max(0, columns), {
		truncationCharacter: unicode ? '…' : '~'
	})
}

/** Fixed safe cell rows, preserving the full prefix before final display shortening. */
export function boundedDisplayLines(
	value: string,
	columns: number,
	rows: number,
	unicode = true
): readonly string[] {
	let remaining = displayText(value, unicode)
	return Array.from({ length: rows }, (_value, index) => {
		if (index === rows - 1)
			return cliTruncate(remaining, Math.max(0, columns), {
				truncationCharacter: unicode ? '…' : '~'
			})
		const line = cliTruncate(remaining, Math.max(0, columns), {
			truncationCharacter: ''
		})
		remaining = remaining.slice(line.length).trimStart()
		return line
	})
}

export interface DisplayClock {
	formatTimestamp(timestamp: number): string
}

export const defaultDisplayClock: DisplayClock = {
	formatTimestamp(timestamp) {
		const date = new Date(timestamp)
		if (!Number.isFinite(date.getTime())) return '--:--:--'
		return [date.getHours(), date.getMinutes(), date.getSeconds()]
			.map(value => String(value).padStart(2, '0'))
			.join(':')
	}
}
