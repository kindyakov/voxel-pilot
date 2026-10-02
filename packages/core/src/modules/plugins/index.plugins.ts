import type { Bot } from '@/types/index.js'

import {
	initArmorManager,
	loadArmorManager
} from '@/modules/plugins/armorManager.js'
import { initAutoEat, loadAutoEat } from '@/modules/plugins/autoEat.js'
import { loadHawkeye } from '@/modules/plugins/hawkeye.js'
import { loadMovement } from '@/modules/plugins/movement.js'
import { initPathfinder, loadPathfinder } from '@/modules/plugins/pathfinder.js'
import { loadPvp } from '@/modules/plugins/pvp.js'
import { loadTool } from '@/modules/plugins/tool.js'

export const loadPlugins = (bot: Bot): void => {
	loadPathfinder(bot)
	loadMovement(bot)
	loadArmorManager(bot)
	loadAutoEat(bot)
	loadTool(bot)
	loadPvp(bot)
	loadHawkeye(bot)
}

export const initPlugins = (bot: Bot): void => {
	initPathfinder(bot)
	initAutoEat(bot)
}
