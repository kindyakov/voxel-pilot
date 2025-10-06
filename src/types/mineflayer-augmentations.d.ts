import type { EatUtil } from 'mineflayer-auto-eat/dist/new.js'
import type { BotUtils } from '../utils/minecraft/botUtils'
import type BotStateMachine from '../core/hsm'

declare module 'mineflayer' {
	interface Bot {
		autoEat: EatUtil
		utils: BotUtils
		hsm: BotStateMachine
	}

	interface BotEvents {
		botReady: () => void
		botDisconnected: (reason: string) => void
		botError: (err: Error) => void
	}
}
