export interface TerminalLayout {
	readonly mode: 'wide' | 'narrow' | 'tiny'
	readonly columns: number
	readonly rows: number
	readonly contentColumns: number
	readonly contentRows: number
	readonly logColumns: number
	readonly statusColumns: number
	readonly logRows: number
}

/** Cell/record budgets belong to the terminal, never the portable log model. */
export function terminalLayout(
	columns: number,
	rows: number,
	failure = false
): TerminalLayout {
	const width = Number.isFinite(columns) ? Math.max(1, Math.floor(columns)) : 80
	const height = Number.isFinite(rows) ? Math.max(1, Math.floor(rows)) : 24
	const contentColumns = Math.max(1, width - 4) // Border plus horizontal padding.
	// Border, header, app state, connection, footer and optional final failure.
	const contentRows = Math.max(0, height - 6 - Number(failure))
	const wide = width >= 120
	const mode =
		width < 50 || contentRows < (wide ? 10 : 15)
			? 'tiny'
			: wide
				? 'wide'
				: 'narrow'
	const logColumns = wide
		? Math.floor((contentColumns - 3) * 0.65)
		: contentColumns
	return Object.freeze({
		mode,
		columns: width,
		rows: height,
		contentColumns,
		contentRows,
		logColumns,
		statusColumns: wide ? contentColumns - logColumns - 3 : contentColumns,
		// Narrow status has ten bounded rows and one divider; log has three headings.
		logRows:
			mode === 'tiny' ? 1 : Math.max(1, contentRows - 3 - (wide ? 0 : 11))
	})
}
