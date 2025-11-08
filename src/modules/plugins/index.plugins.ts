import type { Bot } from '@types'
import { loadPathfinder, initPathfinder } from '@modules/plugins/pathfinder'
import {
	loadArmorManager,
	initArmorManager
} from '@modules/plugins/armorManager'
import { loadMovement } from '@modules/plugins/movement'
import { loadPvp } from '@modules/plugins/pvp'
import { initViewer } from '@modules/plugins/viewer'
import { loadWebInventory } from '@modules/plugins/webInventory'
import { loadAutoEat, initAutoEat } from '@modules/plugins/autoEat'
import { loadTool } from '@modules/plugins/tool'
import { loadHawkeye } from '@modules/plugins/hawkeye'

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
