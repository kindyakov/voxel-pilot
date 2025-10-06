import { loadPathfinder, initPathfinder } from './pathfinder'
import { loadArmorManager, initArmorManager } from './armorManager'
import { loadMovement } from './movement'
import { loadPvp } from './pvp'
import { initViewer } from './viewer'
import { loadWebInventory } from './webInventory'
import { loadAutoEat, initAutoEat } from './autoEat'
import { loadTool } from './tool'
import { loadHawkeye } from './hawkeye.js'
import type { Bot } from '../../types'

export const loadPlugins = (bot: Bot) => {
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

export const initPlugins = (bot: Bot) => {
	initPathfinder(bot)
	// initArmorManager(bot)
	// initViewer(bot)
	initAutoEat(bot)
}
