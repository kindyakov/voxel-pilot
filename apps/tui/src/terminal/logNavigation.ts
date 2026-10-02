/** Terminal capacity is measured in displayed record rows, separate from model history. */
export function logPageSize(rows: number): number {
	// The current stacked Dashboard reserves its status, journal headings and chrome.
	return Math.max(2, rows - 22)
}

export interface LogNavigation {
	toggleDebug(): void
	scroll(offset: number): void
	goLive(): void
}
