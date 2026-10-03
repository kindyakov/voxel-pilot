/** Terminal capacity is measured in displayed record rows, separate from model history. */
import { terminalLayout } from './layout.js'

export function logPageSize(
	rows: number,
	columns = 100,
	failure = false,
	routineReady = false
): number {
	return terminalLayout(columns, rows, failure, routineReady).logRows
}

export interface LogNavigation {
	toggleDebug(): void
	scroll(offset: number): void
	goLive(): void
}
