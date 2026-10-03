import { Box, Text } from 'ink'

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
	const filled =
		ratio === null || !Number.isFinite(ratio)
			? null
			: Math.round(Math.max(0, Math.min(1, ratio)) * 10)
	const bar =
		filled === null
			? unicode
				? '[—]'
				: '[?]'
			: `[${'#'.repeat(filled)}${'-'.repeat(10 - filled)}]`
	const barColor = !color
		? undefined
		: staleValue || staleMaximum || filled === null
			? 'gray'
			: 'green'
	if (expanded)
		return (
			<Box flexDirection='column' width={columns} flexShrink={0}>
				<Box justifyContent='space-between'>
					<Text bold={color} wrap='truncate-end'>
						{label}
					</Text>
					<Text
						dimColor={color && (staleValue || staleMaximum)}
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
		<Text wrap='truncate-end'>
			{label}: {value}
			{staleValue ? ' (устарело)' : ''} / {maximum}
			{staleMaximum ? ' (устарело)' : ''} <Text color={barColor}>{bar}</Text>
		</Text>
	)
}
