import { useInput } from 'ink'

export function ExitInput({
	onExit,
	onFailure
}: {
	readonly onExit: () => void
	readonly onFailure: () => void
}) {
	useInput((input, key) => {
		if (input !== 'q' && !(input === 'c' && key.ctrl)) return
		try {
			void Promise.resolve(onExit()).catch(onFailure)
		} catch {
			onFailure()
		}
	})
	return null
}
