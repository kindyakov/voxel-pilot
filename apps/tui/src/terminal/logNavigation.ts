/** Terminal capacity is measured in displayed record rows, separate from model history. */
export function logPageSize(rows: number): number {
	return Math.max(1, rows - 11)
}

export interface LogNavigation {
	toggleDebug(): void
	scroll(offset: number): void
	goLive(): void
}
