import cliTruncate from 'cli-truncate'

/** Plain single-line text, including defensive handling of injected public fixtures. */
export function safeDisplayText(value: string): string {
	return value.replace(/[\u0000-\u001f\u007f-\u009f]/g, control => {
		if (control === '\n') return ' ↵ '
		if (control === '\t') return ' '
		return `\\u${control.charCodeAt(0).toString(16).padStart(4, '0')}`
	})
}

/** Display ellipsis and source truncation are separate, visible facts. */
export function compactLogMessage(
	message: string,
	columns: number,
	sourceTruncated: boolean
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
			safeDisplayText(message),
			Math.max(0, columns - marker.length)
		) + marker
	)
}

export function compactDisplayText(value: string, columns: number): string {
	return cliTruncate(safeDisplayText(value), Math.max(0, columns))
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
