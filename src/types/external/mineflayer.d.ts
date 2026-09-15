import 'mineflayer'

export interface BotLifecycleEvents {
	botReady: () => void
	botDisconnected: (reason: string) => void
	botError: (error: unknown) => void
}

declare module 'mineflayer' {
	interface BotEvents extends BotLifecycleEvents {}

	interface Bot {
		webInventory?: {
			options: {
				port: number
				webPath: string
				windowUpdateDebounceTime: number
			}
			isRunning: boolean
			start: () => Promise<void>
			stop: () => Promise<void>
		}
	}
}
