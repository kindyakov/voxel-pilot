import type { BotSnapshot } from '@voxel-pilot/contracts'
import { Box, Text } from 'ink'

import type { TerminalCapabilities } from '../../terminal/capabilities.js'
import {
	boundedDisplayLines,
	compactDisplayText
} from '../../terminal/display.js'
import { Meter } from '../../ui/Meter.js'
import { type StatusClock, defaultStatusClock } from './clock.js'
import { toStatusView } from './projection.js'
import { useStatusNow } from './useStatusNow.js'

export type { StatusClock } from './clock.js'

export function StatusPanel({
	snapshot,
	clock = defaultStatusClock,
	columns = 100,
	capabilities = { color: true, unicode: true },
	expanded = false
}: {
	readonly snapshot: BotSnapshot
	readonly clock?: StatusClock
	readonly columns?: number
	readonly capabilities?: TerminalCapabilities
	readonly expanded?: boolean
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
	const goalColor = !color
		? undefined
		: harness.stale
			? 'gray'
			: harness.goal.status === 'paused'
				? 'yellow'
				: harness.goal.status === 'active'
					? 'green'
					: undefined
	if (expanded) {
		const divider = (
			<Text dimColor={color}>{(unicode ? '─' : '-').repeat(columns)}</Text>
		)
		const space = <Text> </Text>
		const lines = (text: string, tone?: 'magenta' | 'gray') =>
			boundedDisplayLines(text, columns, 2, unicode).map((line, index) => (
				<Text key={index} wrap='truncate-end' color={color ? tone : undefined}>
					{line || ' '}
				</Text>
			))
		return (
			<Box flexDirection='column' flexShrink={0} width={columns}>
				<Meter
					label='HP'
					value={view.health.text}
					maximum={view.maxHealth.text}
					ratio={view.healthRatio}
					staleValue={view.health.stale}
					staleMaximum={view.maxHealth.stale}
					color={color}
					unicode={unicode}
					expanded
					columns={columns}
				/>
				{space}
				<Meter
					label='Сытость'
					value={view.food.text}
					maximum='20'
					ratio={view.foodRatio}
					staleValue={view.food.stale}
					color={color}
					unicode={unicode}
					expanded
					columns={columns}
				/>
				{space}
				{divider}
				<Text dimColor={color}>ПОЗИЦИЯ</Text>
				<Text dimColor={color && view.position.stale} wrap='truncate-end'>
					{clip(view.position.text, view.position.stale ? ' · устарело' : '')}
				</Text>
				{space}
				{divider}
				<Text dimColor={color}>HSM</Text>
				{lines(
					harness.mainActivity + stale,
					harness.stale ? 'gray' : 'magenta'
				)}
				<Text dimColor={color && harness.stale} wrap='truncate-end'>
					{clip(
						`${harness.stale ? 'Последний вход' : 'Время состояния'}: ${harness.elapsed}`,
						stale
					)}
				</Text>
				{lines(
					`Действие: ${harness.action}${stale}`,
					harness.stale ? 'gray' : undefined
				)}
				{lines(
					`Мониторинг: ${harness.monitoring.join(', ')}${stale}`,
					harness.stale ? 'gray' : undefined
				)}
				{divider}
				<Text dimColor={color}>ЦЕЛЬ</Text>
				{lines(harness.goal.text ?? '—', harness.stale ? 'gray' : undefined)}
				<Text color={goalColor} wrap='truncate-end'>
					{clip(harness.goal.label, stale)}
				</Text>
			</Box>
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
				unicode={unicode}
			/>
			<Meter
				label='Сытость'
				value={view.food.text}
				maximum='20'
				ratio={view.foodRatio}
				staleValue={view.food.stale}
				color={color}
				unicode={unicode}
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
			<Text color={goalColor} wrap='truncate-end'>
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
