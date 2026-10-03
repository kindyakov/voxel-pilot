import type { BotSnapshot } from '@voxel-pilot/contracts'
import { Box, Text } from 'ink'

import type { TerminalCapabilities } from '../../terminal/capabilities.js'
import {
	boundedDisplayLines,
	compactDisplayText
} from '../../terminal/display.js'
import { Meter } from '../../ui/Meter.js'
import { palette } from '../../ui/palette.js'
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
			? palette.muted
			: harness.goal.status === 'paused'
				? palette.yellow
				: harness.goal.status === 'active'
					? palette.green
					: palette.foreground
	if (expanded) {
		const divider = (
			<Text color={color ? palette.border : undefined}>
				{(unicode ? '─' : '-').repeat(columns)}
			</Text>
		)
		const space = <Text> </Text>
		const lines = (
			text: string,
			tone: string = palette.foreground,
			bold = false
		) =>
			boundedDisplayLines(text, columns, 2, unicode)
				.filter(Boolean)
				.map((line, index) => (
					<Text
						key={index}
						bold={color && bold}
						wrap='truncate-end'
						color={color ? tone : undefined}
					>
						{line}
					</Text>
				))
		const activity = [
			...lines(
				harness.action + stale,
				harness.stale ? palette.muted : palette.foreground,
				true
			),
			...lines(
				harness.mainActivity + stale,
				harness.stale ? palette.muted : palette.pink
			),
			<Text color={color ? palette.muted : undefined} wrap='truncate-end'>
				{clip(
					`${harness.stale ? 'Последний вход' : 'Время состояния'}: ${harness.elapsed}`,
					stale
				)}
			</Text>,
			...lines(
				`Мониторинг: ${harness.monitoring.join(', ')}${stale}`,
				harness.stale ? palette.muted : palette.foreground
			)
		]
		const goal = [
			...lines(
				harness.goal.text ?? '—',
				harness.stale ? palette.muted : palette.foreground,
				true
			),
			<Text color={goalColor} wrap='truncate-end'>
				{clip(harness.goal.label, stale)}
			</Text>
		]
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
				<Text bold={color} color={color ? palette.muted : undefined}>
					ПОЗИЦИЯ
				</Text>
				<Text
					bold={color}
					color={
						color
							? view.position.stale
								? palette.muted
								: palette.foreground
							: undefined
					}
					wrap='truncate-end'
				>
					{clip(
						view.position.text.replaceAll(' · ', '   '),
						view.position.stale ? ' · устарело' : ''
					)}
				</Text>
				{space}
				{divider}
				<Text bold={color} color={color ? palette.muted : undefined}>
					HSM
				</Text>
				{activity.map((line, index) => (
					<Box key={index} flexShrink={0}>
						{line}
					</Box>
				))}
				{Array.from({ length: 7 - activity.length }, (_value, index) => (
					<Text key={index}> </Text>
				))}
				{divider}
				<Text bold={color} color={color ? palette.muted : undefined}>
					ЦЕЛЬ
				</Text>
				{goal.map((line, index) => (
					<Box key={index} flexShrink={0}>
						{line}
					</Box>
				))}
				{Array.from({ length: 3 - goal.length }, (_value, index) => (
					<Text key={index}> </Text>
				))}
			</Box>
		)
	}
	return (
		<Box flexDirection='column' flexShrink={0} width={columns}>
			<Text bold={color} color={color ? palette.foreground : undefined}>
				СТАТУС
			</Text>
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
			<Text
				color={
					color
						? view.position.stale
							? palette.muted
							: palette.foreground
						: undefined
				}
				wrap='truncate-end'
			>
				{clip(
					`ПОЗИЦИЯ: ${view.position.text}`,
					view.position.stale ? ' · устарело' : ''
				)}
			</Text>
			<Text
				color={
					color ? (harness.stale ? palette.muted : palette.pink) : undefined
				}
				wrap='truncate-end'
			>
				{clip(`HSM: ${harness.mainActivity}`, stale)}
			</Text>
			<Text color={color ? palette.muted : undefined} wrap='truncate-end'>
				{clip(
					`${harness.stale ? (columns < 50 ? 'Последний вход' : 'От входа в последнее состояние') : 'Время состояния'}: ${harness.elapsed}`,
					stale
				)}
			</Text>
			<Text
				color={
					color
						? harness.stale
							? palette.muted
							: palette.foreground
						: undefined
				}
				wrap='truncate-end'
			>
				{clip(`Действие: ${harness.action}`, stale)}
			</Text>
			<Text
				color={
					color
						? harness.stale
							? palette.muted
							: palette.foreground
						: undefined
				}
				wrap='truncate-end'
			>
				{clip(`Мониторинг: ${harness.monitoring.join(', ')}`, stale)}
			</Text>
			<Text color={goalColor} wrap='truncate-end'>
				{clip(`ЦЕЛЬ: ${harness.goal.label}`, stale)}
			</Text>
			{harness.goal.text !== null && (
				<Text
					color={
						color
							? harness.stale
								? palette.muted
								: palette.foreground
							: undefined
					}
					wrap='truncate-end'
				>
					{clip(harness.goal.text)}
				</Text>
			)}
		</Box>
	)
}
