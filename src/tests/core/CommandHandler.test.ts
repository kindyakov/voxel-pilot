import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'

import {
	AI_PILOT_UNAVAILABLE_COMMAND_MESSAGE,
	type DisabledAiProvider
} from '../../ai/pilotAvailability.js'
import CommandHandler from '../../core/CommandHandler.js'
import type { UserEvents } from '../../hsm/types.js'

class FakeBot extends EventEmitter {
	username = 'Bot'
	chatMessages: string[] = []

	chat(message: string): void {
		this.chatMessages.push(message)
	}
}

test('CommandHandler ignores plain chat messages without command prefix', () => {
	const bot = new FakeBot() as any
	const events: unknown[] = []
	const hsm = {
		send: (event: unknown) => {
			events.push(event)
		}
	} as any

	new CommandHandler(bot, hsm)
	bot.emit('chat', 'Steve', 'Build a 5x5 wooden box')

	assert.deepEqual(events, [])
})

test('CommandHandler forwards prefixed chat messages as USER_COMMAND without prefix', () => {
	const bot = new FakeBot() as any
	const events: unknown[] = []
	const hsm = {
		send: (event: unknown) => {
			events.push(event)
		}
	} as any

	new CommandHandler(bot, hsm)
	bot.emit('chat', 'Steve', ':Build a 5x5 wooden box')

	assert.deepEqual(events, [
		{
			type: 'USER_COMMAND',
			username: 'Steve',
			text: 'Build a 5x5 wooden box'
		}
	])
})

test('CommandHandler trims whitespace around prefixed command payload', () => {
	const bot = new FakeBot() as any
	const events: unknown[] = []
	const hsm = {
		send: (event: unknown) => {
			events.push(event)
		}
	} as any

	new CommandHandler(bot, hsm)
	bot.emit('chat', 'Steve', '   :   smelt iron   ')

	assert.deepEqual(events, [
		{
			type: 'USER_COMMAND',
			username: 'Steve',
			text: 'smelt iron'
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

test('CommandHandler ignores empty prefixed command payloads', () => {
	const bot = new FakeBot() as any
	const events: unknown[] = []
	const hsm = {
		send: (event: unknown) => {
			events.push(event)
		}
	} as any

	new CommandHandler(bot, hsm)
	bot.emit('chat', 'Steve', ':')
	bot.emit('chat', 'Steve', '   :   ')

	assert.deepEqual(events, [])
})

test('CommandHandler rejects goals for network-free providers but allows :stop', () => {
	const providers: DisabledAiProvider[] = ['disabled', 'local']
	for (const provider of providers) {
		const bot = new FakeBot()
		const events: UserEvents[] = []
		const hsm = {
			send: (event: UserEvents) => {
				events.push(event)
			}
		}
		const config = {
			ai: {
				provider,
				baseUrl: undefined,
				model: provider,
				apiKey: undefined,
				timeout: 1,
				maxTokens: 1
			}
		}

		new CommandHandler(bot, hsm, config)
		bot.emit('chat', 'Steve', ':collect wood')
		bot.emit('chat', 'Steve', ':stop')

		assert.deepEqual(events, [{ type: 'STOP_CURRENT_GOAL', username: 'Steve' }])
		assert.deepEqual(bot.chatMessages, [AI_PILOT_UNAVAILABLE_COMMAND_MESSAGE])
	}
})
