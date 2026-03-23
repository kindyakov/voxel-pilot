import type { Bot } from '@types'

import {
	initArmorManager,
	loadArmorManager
} from '@modules/plugins/armorManager'
import { initAutoEat, loadAutoEat } from '@modules/plugins/autoEat'
import { loadHawkeye } from '@modules/plugins/hawkeye'
import { loadMovement } from '@modules/plugins/movement'
import { initPathfinder, loadPathfinder } from '@modules/plugins/pathfinder'
import { loadPvp } from '@modules/plugins/pvp'
import { loadTool } from '@modules/plugins/tool'
import { initViewer } from '@modules/plugins/viewer'
import { loadWebInventory } from '@modules/plugins/webInventory'

export const loadPlugins = (bot: Bot): void => {
	loadPathfinder(bot)
	loadMovement(bot)
	loadArmorManager(bot)
	// loadWebInventory(bot)
	loadAutoEat(bot)
	// loadDashboard(bot)
	loadTool(bot) // походу не совместим
	loadPvp(bot)
	loadHawkeye(bot)
}

export const initPlugins = (bot: Bot): void => {
	initPathfinder(bot)
	// initArmorManager(bot)
	// initViewer(bot)
	initAutoEat(bot)
}
