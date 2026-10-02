import type { BotSnapshot } from '@voxel-pilot/contracts'
import { Box, Text } from 'ink'

import type { TerminalCapabilities } from '../../terminal/capabilities.js'
import { compactDisplayText } from '../../terminal/display.js'
import { Meter } from '../../ui/Meter.js'
import { type StatusClock, defaultStatusClock } from './clock.js'
import { toStatusView } from './projection.js'
import { useStatusNow } from './useStatusNow.js'

export type { StatusClock } from './clock.js'

export function StatusPanel({
	snapshot,
	clock = defaultStatusClock,
	columns = 100,
	capabilities = { color: true, unicode: true }
}: {
	readonly snapshot: BotSnapshot
	readonly clock?: StatusClock
	readonly columns?: number
	readonly capabilities?: TerminalCapabilities
}) {
	const view = toStatusView(snapshot, useStatusNow(clock))
	const harness = view.harness
	const stale = harness.stale ? ' · устарело' : ''
	const { color, unicode } = capabilities
	const clip = (text: string, suffix = '') => {
		return (
			compactDisplayText(text, Math.max(0, columns - suffix.length), unicode) +
			(unicode ? suffix : suffix.replace(' · ', ' | '))
		)
	}
	return (
		<Box flexDirection='column' flexShrink={0} width={columns}>
			<Text bold={color}>СТАТУС</Text>
			<Meter
				label='HP'
				value={view.health.text}
				maximum={view.maxHealth.text}
				ratio={view.healthRatio}
				staleValue={view.health.stale}
				staleMaximum={view.maxHealth.stale}
				color={color}
			/>
			<Meter
				label='Сытость'
				value={view.food.text}
				maximum='20'
				ratio={view.foodRatio}
				staleValue={view.food.stale}
				color={color}
			/>
			<Text dimColor={color && view.position.stale} wrap='truncate-end'>
				{clip(
					`ПОЗИЦИЯ: ${view.position.text}`,
					view.position.stale ? ' · устарело' : ''
				)}
			</Text>
			<Text
				color={color ? (harness.stale ? 'gray' : 'magenta') : undefined}
				wrap='truncate-end'
			>
				{clip(`HSM: ${harness.mainActivity}`, stale)}
			</Text>
			<Text dimColor={color && harness.stale} wrap='truncate-end'>
				{clip(
					`${harness.stale ? (columns < 50 ? 'Последний вход' : 'От входа в последнее состояние') : 'Время состояния'}: ${harness.elapsed}`,
					stale
				)}
			</Text>
			<Text dimColor={color && harness.stale} wrap='truncate-end'>
				{clip(`Действие: ${harness.action}`, stale)}
			</Text>
			<Text dimColor={color && harness.stale} wrap='truncate-end'>
				{clip(`Мониторинг: ${harness.monitoring.join(', ')}`, stale)}
			</Text>
			<Text
				color={
					!color
						? undefined
						: harness.stale
							? 'gray'
							: harness.goal.status === 'paused'
								? 'yellow'
								: harness.goal.status === 'active'
									? 'green'
									: undefined
				}
				wrap='truncate-end'
			>
				{clip(`ЦЕЛЬ: ${harness.goal.label}`, stale)}
			</Text>
			{harness.goal.text !== null && (
				<Text dimColor={color && harness.stale} wrap='truncate-end'>
					{clip(harness.goal.text)}
				</Text>
			)}
		</Box>
	)
}
