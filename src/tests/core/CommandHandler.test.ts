import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'

import CommandHandler from '../../core/CommandHandler.js'

class FakeBot extends EventEmitter {
	username = 'Bot'
}

test('CommandHandler forwards plain chat messages as USER_COMMAND', () => {
	const bot = new FakeBot() as any
	const events: unknown[] = []
	const hsm = {
		send: (event: unknown) => {
			events.push(event)
		}
	} as any

	new CommandHandler(bot, hsm)
	bot.emit('chat', 'Steve', 'Build a 5x5 wooden box')

	assert.deepEqual(events, [
		{
			type: 'USER_COMMAND',
			username: 'Steve',
			text: 'Build a 5x5 wooden box'
		}
	])
})

test('CommandHandler treats :stop as STOP_CURRENT_GOAL override', () => {
	const bot = new FakeBot() as any
	const events: unknown[] = []
	const hsm = {
		send: (event: unknown) => {
			events.push(event)
		}
	} as any

	new CommandHandler(bot, hsm)
	bot.emit('chat', 'Steve', ':stop')

	assert.deepEqual(events, [
		{
			type: 'STOP_CURRENT_GOAL',
			username: 'Steve'
		}
	])
})
