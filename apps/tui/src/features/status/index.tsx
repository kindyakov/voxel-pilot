import type { BotSnapshot } from '@voxel-pilot/contracts'
import { Box, Text } from 'ink'

import { safeDisplayText } from '../../terminal/display.js'
import { Meter } from '../../ui/Meter.js'
import { type StatusClock, defaultStatusClock } from './clock.js'
import { toStatusView } from './projection.js'
import { useStatusNow } from './useStatusNow.js'

export type { StatusClock } from './clock.js'

export function StatusPanel({
	snapshot,
	clock = defaultStatusClock
}: {
	readonly snapshot: BotSnapshot
	readonly clock?: StatusClock
}) {
	const view = toStatusView(snapshot, useStatusNow(clock))
	const harness = view.harness
	const stale = harness.stale ? ' · устарело' : ''
	return (
		<Box flexDirection='column' flexShrink={0}>
			<Text bold>СТАТУС</Text>
			<Meter
				label='HP'
				value={view.health.text}
				maximum={view.maxHealth.text}
				ratio={view.healthRatio}
				staleValue={view.health.stale}
				staleMaximum={view.maxHealth.stale}
			/>
			<Meter
				label='Сытость'
				value={view.food.text}
				maximum='20'
				ratio={view.foodRatio}
				staleValue={view.food.stale}
			/>
			<Text dimColor={view.position.stale}>
				ПОЗИЦИЯ: {view.position.text}
				{view.position.stale ? ' · устарело' : ''}
			</Text>
			<Text color={harness.stale ? 'gray' : 'magenta'}>
				HSM: {safeDisplayText(harness.mainActivity)}
				{stale}
			</Text>
			<Text dimColor={harness.stale}>
				{harness.stale ? 'От входа в последнее состояние' : 'Время состояния'}:{' '}
				{harness.elapsed}
				{stale}
			</Text>
			<Text dimColor={harness.stale}>
				Действие: {safeDisplayText(harness.action)}
				{stale}
			</Text>
			<Text dimColor={harness.stale}>
				Мониторинг: {harness.monitoring.map(safeDisplayText).join(', ')}
				{stale}
			</Text>
			<Text
				color={
					harness.stale
						? 'gray'
						: harness.goal.status === 'paused'
							? 'yellow'
							: harness.goal.status === 'active'
								? 'green'
								: undefined
				}
			>
				ЦЕЛЬ: {harness.goal.label}
				{stale}
			</Text>
			{harness.goal.text !== null && (
				<Text dimColor={harness.stale} wrap='truncate-end'>
					{safeDisplayText(harness.goal.text)}
				</Text>
			)}
		</Box>
	)
}
