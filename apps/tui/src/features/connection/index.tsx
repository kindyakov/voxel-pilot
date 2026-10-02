import type { ConnectionSnapshot, RuntimeProblem } from '@voxel-pilot/contracts'
import { Box, Text } from 'ink'

import type { TerminalCapabilities } from '../../terminal/capabilities.js'
import { compactDisplayText } from '../../terminal/display.js'

export function ConnectionPanel({
	connection,
	failure,
	columns = 100,
	capabilities = { color: true, unicode: true }
}: {
	readonly connection: ConnectionSnapshot
	readonly failure: RuntimeProblem | null
	readonly columns?: number
	readonly capabilities?: TerminalCapabilities
}) {
	return (
		<Box flexDirection='column' flexShrink={0}>
			<Text
				color={
					!capabilities.color
						? undefined
						: connection.state === 'ready'
							? 'green'
							: failure
								? 'red'
								: 'yellow'
				}
				wrap='truncate-end'
			>
				{compactDisplayText(
					`${connection.state.toUpperCase()} · attempt ${connection.retryAttempt}`,
					columns,
					capabilities.unicode
				)}
			</Text>
			{failure && (
				<Text
					color={capabilities.color ? 'red' : undefined}
					wrap='truncate-end'
				>
					{compactDisplayText(failure.message, columns, capabilities.unicode)}
				</Text>
			)}
		</Box>
	)
}
