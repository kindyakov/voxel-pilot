import pathfinderPackage from 'mineflayer-pathfinder'

import { loadMovement } from '../../../modules/plugins/movement.js'
import { loadPvp } from '../../../modules/plugins/pvp.js'
import { HandoffBot } from '../../hsm/fixtures/handoffBot.js'

/** One raw connection double with native plugins; the runtime creates its only HSM. */
export function createRuntimeConnectionBot(username = 'HandoffBot') {
	const bot = new HandoffBot()
	bot.username = username
	bot.loadPlugin(pathfinderPackage.pathfinder)
	loadPvp(bot.asBot())
	loadMovement(bot.asBot())
	bot.movements = new pathfinderPackage.Movements(bot.asBot())
	bot.pvp.movements = bot.movements
	bot.pathfinder.setMovements(bot.movements)
	return Object.assign(bot, {
		quitCalls: 0,
		quit(reason?: string) {
			this.quitCalls++
			bot.emit('end', reason)
		}
	})
}
