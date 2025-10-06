import pathFinderPkg from 'mineflayer-pathfinder';
import type { Bot } from '../../types'

const { pathfinder, Movements } = pathFinderPkg;

export const loadPathfinder = (bot: Bot) => {
  bot.loadPlugin(pathfinder)
}

export const initPathfinder = (bot: Bot) => {
  const movements = new Movements(bot)

  bot.pathfinder.setMovements(movements)
  bot.movements = movements
  bot.pvp.movements = movements
}