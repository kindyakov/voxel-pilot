import cliTruncate from 'cli-truncate'
import { Box, Text } from 'ink'

import { palette } from './palette.js'

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
		Math.max(0, columns - brand.length - 2),
		options
	)
	const left = brand + (state ? `  ${state}` : '')
	const remaining = Math.max(0, columns - left.length - 1)
	return (
		<Box justifyContent='space-between' flexShrink={0}>
			<Text bold={color} wrap='truncate-end'>
				<Text color={color ? palette.pink : undefined}>{brand}</Text>
				{state && (
					<>
						{'  '}
						<Text color={color ? palette[statusColor] : undefined}>
							{state}
						</Text>
					</>
				)}
			</Text>
			{remaining > 0 && right && (
				<Text color={color ? palette.muted : undefined} wrap='truncate-end'>
					{cliTruncate(right, remaining, options)}
				</Text>
			)}
		</Box>
	)
}
