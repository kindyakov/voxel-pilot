import { Text } from 'ink'

export function Meter({
	label,
	value,
	maximum,
	ratio,
	staleValue = false,
	staleMaximum = false
}: {
	readonly label: string
	readonly value: string
	readonly maximum: string
	readonly ratio: number | null
	readonly staleValue?: boolean
	readonly staleMaximum?: boolean
}) {
	const filled =
		ratio === null || !Number.isFinite(ratio)
			? null
			: Math.round(Math.max(0, Math.min(1, ratio)) * 10)
	const bar =
		filled === null
			? '[—]'
			: `[${'#'.repeat(filled)}${'-'.repeat(10 - filled)}]`
	return (
		<Text>
			{label}: {value}
			{staleValue ? ' (устарело)' : ''} / {maximum}
			{staleMaximum ? ' (устарело)' : ''}{' '}
			<Text
				color={staleValue || staleMaximum || filled === null ? 'gray' : 'green'}
			>
				{bar}
			</Text>
		</Text>
	)
}
