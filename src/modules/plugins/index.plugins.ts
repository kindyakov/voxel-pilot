import { loadPathfinder, initPathfinder } from './pathfinder'
import { loadArmorManager, initArmorManager } from './armorManager'
import { loadMovement } from './movement'
import { loadPvp } from './pvp'
import { initViewer } from './viewer'
import { loadWebInventory } from './webInventory'
import { loadAutoEat, initAutoEat } from './autoEat'
import { loadTool } from './tool'
import { loadHawkeye } from './hawkeye'
import type { Bot } from '../../types'

export const loadPlugins = (bot: Bot): void => {
	loadPathfinder(bot)
	// loadMovement(bot)
	loadArmorManager(bot)
	// loadWebInventory(bot)
	loadAutoEat(bot)
	// loadDashboard(bot)
	// loadTool(bot) // походу не совместим
	loadPvp(bot)
	loadHawkeye(bot)
}

export const initPlugins = (bot: Bot): void => {
	initPathfinder(bot)
	// initArmorManager(bot)
	// initViewer(bot)
	initAutoEat(bot)
}
