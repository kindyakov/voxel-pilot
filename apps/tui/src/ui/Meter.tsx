import { Box, Text } from 'ink'

import { palette } from './palette.js'

export function Meter({
	label,
	value,
	maximum,
	ratio,
	staleValue = false,
	staleMaximum = false,
	color = true,
	expanded = false,
	columns = 100,
	unicode = true
}: {
	readonly label: string
	readonly value: string
	readonly maximum: string
	readonly ratio: number | null
	readonly staleValue?: boolean
	readonly staleMaximum?: boolean
	readonly color?: boolean
	readonly expanded?: boolean
	readonly columns?: number
	readonly unicode?: boolean
}) {
	const cells = expanded ? 14 : 10
	const filled =
		ratio === null || !Number.isFinite(ratio)
			? null
			: Math.round(Math.max(0, Math.min(1, ratio)) * cells)
	const bar =
		filled === null
			? unicode
				? '[—]'
				: '[?]'
			: `[${'#'.repeat(filled)}${'-'.repeat(cells - filled)}]`
	const barColor = !color
		? undefined
		: staleValue || staleMaximum || filled === null
			? palette.muted
			: palette.green
	if (expanded)
		return (
			<Box flexDirection='column' width={columns} flexShrink={0}>
				<Box justifyContent='space-between'>
					<Text
						bold={color}
						color={color ? palette.foreground : undefined}
						wrap='truncate-end'
					>
						{label}
					</Text>
					<Text
						color={
							color
								? staleValue || staleMaximum
									? palette.muted
									: palette.foreground
								: undefined
						}
						wrap='truncate-end'
					>
						{value}
						{staleValue ? ' (устарело)' : ''}/{maximum}
						{staleMaximum ? ' (устарело)' : ''}
					</Text>
				</Box>
				<Text color={barColor}>{bar}</Text>
			</Box>
		)
	return (
		<Text color={color ? palette.foreground : undefined} wrap='truncate-end'>
			{label}: {value}
			{staleValue ? ' (устарело)' : ''} / {maximum}
			{staleMaximum ? ' (устарело)' : ''} <Text color={barColor}>{bar}</Text>
		</Text>
	)
}
