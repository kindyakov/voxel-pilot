declare module 'mineflayer-web-inventory' {
	import type { Bot } from 'mineflayer'

	interface WebInventoryOptions {
		port?: number | string
		webPath?: string
		path?: string
		express?: any
		app?: any
		http?: any
		io?: any
		windowUpdateDebounceTime?: number
		debounceTime?: number
		startOnLoad?: boolean
	}

	function webInventory(bot: Bot, options?: WebInventoryOptions): void

	export = webInventory
}

declare module 'mineflayer' {
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
