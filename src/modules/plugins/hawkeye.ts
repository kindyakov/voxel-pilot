import hawkeyePlugin from 'minecrafthawkeye'

import type { Bot } from '../../types'

export const loadHawkeye = (bot: Bot): void => {
	bot.loadPlugin((hawkeyePlugin as any).default || hawkeyePlugin)
}
