import pathFinderPkg from 'mineflayer-pathfinder'
import type { Bot } from '../../types'

const { pathfinder, Movements } = pathFinderPkg

export const loadPathfinder = (bot: Bot): void => {
	bot.loadPlugin(pathfinder)
}

export const initPathfinder = (bot: Bot): void => {
	const movements = new Movements(bot)

	bot.pathfinder.setMovements(movements)
	bot.movements = movements
	bot.pvp.movements = movements
}
