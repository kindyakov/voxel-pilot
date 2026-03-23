import pathFinderPkg from 'mineflayer-pathfinder'

import type { Bot } from '@types'

const { pathfinder, Movements } = pathFinderPkg

export const loadPathfinder = (bot: Bot): void => {
	bot.loadPlugin(pathfinder)
}

export const initPathfinder = (bot: Bot): void => {
	const movements = new Movements(bot)

	bot.pathfinder.setMovements(movements)
	bot.movements = movements
	bot.pvp.movements = movements

	// Перехватываем копание блоков через pathfinder
	setupSmartToolSelection(bot)
}

/**
 * Настраивает автоматический выбор подходящего инструмента
 * когда pathfinder начинает копать блоки
 */
function setupSmartToolSelection(bot: Bot): void {
	bot.on('blockBreakProgressObserved', async (block, destroyStage, entity) => {
		if (!entity || entity.id !== bot.entity.id) return
		if (destroyStage !== 0) return

		try {
			// Всегда пытаемся найти лучший инструмент
			// requireHarvest: false -> выбирает лучший, даже если блок копается рукой
			await bot.tool.equipForBlock(block, { requireHarvest: false })

			const equipped = bot.heldItem
			console.log(
				equipped
					? `⛏️  [PathfinderDig] ${block.name} → ${equipped.name}`
					: `🤚 [PathfinderDig] ${block.name} → рука`
			)
		} catch (error) {
			// Если нет подходящего инструмента - копаем тем, что есть
			console.log(
				`⚠️  [PathfinderDig] ${block.name} → нет подходящего инструмента`
			)
		}
	})
}
