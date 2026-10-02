import type { ConnectionSnapshot, RuntimeProblem } from '@voxel-pilot/contracts'
import { Box, Text } from 'ink'

import { safeDisplayText } from '../../terminal/display.js'

export function ConnectionPanel({
	connection,
	failure
}: {
	readonly connection: ConnectionSnapshot
	readonly failure: RuntimeProblem | null
}) {
	return (
		<Box flexDirection='column'>
			<Text
				color={
					connection.state === 'ready' ? 'green' : failure ? 'red' : 'yellow'
				}
			>
				{safeDisplayText(connection.state.toUpperCase())} · attempt{' '}
				{connection.retryAttempt}
			</Text>
			{failure && (
				<Text color='red' wrap='truncate-end'>
					{safeDisplayText(failure.message)}
				</Text>
			)}
		</Box>
	)
}
