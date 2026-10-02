import cliTruncate from 'cli-truncate'
import { Box, Text } from 'ink'

export function Header({
	status,
	right = '',
	columns = 100,
	color = true,
	statusColor = 'green',
	unicode = true
}: {
	readonly status: string
	readonly right?: string
	readonly columns?: number
	readonly color?: boolean
	readonly statusColor?: 'green' | 'yellow' | 'red'
	readonly unicode?: boolean
}) {
	const options = { truncationCharacter: unicode ? '…' : '~' }
	const brand = cliTruncate('VoxelPilot', columns, options)
	const state = cliTruncate(
		status,
		Math.max(0, columns - brand.length - 1),
		options
	)
	const left = brand + (state ? ` ${state}` : '')
	const remaining = Math.max(0, columns - left.length - 1)
	return (
		<Box justifyContent='space-between' flexShrink={0}>
			<Text bold={color} wrap='truncate-end'>
				<Text color={color ? 'magenta' : undefined}>{brand}</Text>
				{state && (
					<>
						{' '}
						<Text color={color ? statusColor : undefined}>{state}</Text>
					</>
				)}
			</Text>
			{remaining > 0 && right && (
				<Text dimColor={color} wrap='truncate-end'>
					{cliTruncate(right, remaining, options)}
				</Text>
			)}
		</Box>
	)
}
