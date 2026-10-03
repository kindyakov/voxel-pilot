import type { BotSnapshot, Measurement } from '@voxel-pilot/contracts'

export interface DisplayValue {
	readonly text: string
	readonly stale: boolean
}

export interface StatusView {
	readonly health: DisplayValue
	readonly maxHealth: DisplayValue
	readonly healthRatio: number | null
	readonly food: DisplayValue
	readonly foodRatio: number | null
	readonly position: DisplayValue
	readonly harness: {
		readonly mainActivity: string
		readonly elapsed: string
		readonly action: string
		readonly monitoring: readonly string[]
		readonly stale: boolean
		readonly goal: {
			readonly status: 'unknown' | 'none' | 'active' | 'paused'
			readonly label: string
			readonly text: string | null
		}
	}
}

export function formatNumber(value: number | null): string {
	if (value === null || !Number.isFinite(value)) return '—'
	const rounded = Number(value.toFixed(2))
	return String(Object.is(rounded, -0) ? 0 : rounded)
}

export function formatElapsed(enteredAt: number, now: number): string {
	const seconds = Math.max(0, Math.floor((now - enteredAt) / 1000))
	if (
		!Number.isFinite(enteredAt) ||
		!Number.isFinite(now) ||
		!Number.isFinite(seconds)
	)
		return '—'
	const minutes = Math.floor(seconds / 60) % 60
	const hours = Math.floor(seconds / 3600)
	const pair = (value: number) => String(value).padStart(2, '0')
	return hours > 0
		? `${pair(hours)}:${pair(minutes)}:${pair(seconds % 60)}`
		: `${pair(minutes)}:${pair(seconds % 60)}`
}

function ratio(value: number | null, maximum: number | null): number | null {
	return value !== null &&
		maximum !== null &&
		Number.isFinite(value) &&
		Number.isFinite(maximum) &&
		maximum > 0
		? Math.max(0, Math.min(1, value / maximum))
		: null
}

function numeric(measurement: Measurement<number>): DisplayValue {
	return { text: formatNumber(measurement.value), stale: measurement.stale }
}

function path(value: string): string {
	return value.split('.').join(' > ')
}

/** Public facts only; rendering controls and terminal geometry belong to the view. */
export function toStatusView(snapshot: BotSnapshot, now: number): StatusView {
	const position = snapshot.position.value
	const harness = snapshot.harness.value
	return {
		health: numeric(snapshot.health),
		maxHealth: numeric(snapshot.maxHealth),
		healthRatio: ratio(snapshot.health.value, snapshot.maxHealth.value),
		food: numeric(snapshot.food),
		foodRatio: ratio(snapshot.food.value, 20),
		position: {
			text: `X ${formatNumber(position?.x ?? null)} · Y ${formatNumber(position?.y ?? null)} · Z ${formatNumber(position?.z ?? null)}`,
			stale: snapshot.position.stale
		},
		harness:
			harness === null
				? {
						mainActivity: '—',
						elapsed: '—',
						action: '—',
						monitoring: ['—'],
						stale: snapshot.harness.stale,
						goal: { status: 'unknown', label: '—', text: null }
					}
				: {
						mainActivity: path(harness.mainActivity),
						elapsed: formatElapsed(harness.enteredAt, now),
						action: harness.action ?? 'Нет',
						monitoring: harness.monitoring.length
							? harness.monitoring.map(path)
							: ['Нет'],
						stale: snapshot.harness.stale,
						goal: {
							status: harness.goal.status,
							label:
								harness.goal.status === 'none'
									? 'Нет поручения'
									: harness.goal.status === 'active'
										? 'В работе'
										: 'На паузе',
							text: harness.goal.text
						}
					}
	}
}
