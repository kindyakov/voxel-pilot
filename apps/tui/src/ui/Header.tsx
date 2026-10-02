import { Box, Text } from 'ink'

export function Header({ status }: { readonly status: string }) {
	return (
		<Box justifyContent='space-between'>
			<Text bold color='magenta'>
				VoxelPilot
			</Text>
			<Text>{status}</Text>
		</Box>
	)
}
