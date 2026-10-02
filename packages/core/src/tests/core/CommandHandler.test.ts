import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'

import { isAiPilotDisabled } from '../../ai/pilotAvailability.js'
import {
	AI_PILOT_UNAVAILABLE_COMMAND_MESSAGE,
	type DisabledAiProvider
} from '../../ai/pilotAvailability.js'
import { createRuntimeLogger } from '../../config/runtimeLogger.js'
import CommandHandler from '../../core/CommandHandler.js'
import type { UserEvents } from '../../hsm/types.js'

class FakeBot extends EventEmitter {
	username = 'Bot'
	chatMessages: string[] = []

	chat(message: string): void {
		this.chatMessages.push(message)
	}
}

function dependencies(t: test.TestContext, aiPilotEnabled = true) {
	const handle = createRuntimeLogger({
		aiModel: 'fixture',
		console: false,
		files: false
	})
	t.after(() => handle.close())
	return { logger: handle.logger, aiPilotEnabled }
}

test('CommandHandler ignores plain chat messages without command prefix', t => {
	const bot = new FakeBot()
	const events: unknown[] = []
	const hsm = {
		send: (event: unknown) => {
			events.push(event)
		}
	}

	new CommandHandler(bot, hsm, dependencies(t))
	bot.emit('chat', 'Steve', 'Build a 5x5 wooden box')

	assert.deepEqual(events, [])
})

test('CommandHandler forwards prefixed chat messages as USER_COMMAND without prefix', t => {
	const bot = new FakeBot()
	const events: unknown[] = []
	const hsm = {
		send: (event: unknown) => {
			events.push(event)
		}
	}

	new CommandHandler(bot, hsm, dependencies(t))
	bot.emit('chat', 'Steve', ':Build a 5x5 wooden box')

	assert.deepEqual(events, [
		{
			type: 'USER_COMMAND',
			username: 'Steve',
			text: 'Build a 5x5 wooden box'
		}
	])
})

test('CommandHandler trims whitespace around prefixed command payload', t => {
	const bot = new FakeBot()
	const events: unknown[] = []
	const hsm = {
		send: (event: unknown) => {
			events.push(event)
		}
	}

	new CommandHandler(bot, hsm, dependencies(t))
	bot.emit('chat', 'Steve', '   :   smelt iron   ')

	assert.deepEqual(events, [
		{
			type: 'USER_COMMAND',
			username: 'Steve',
			text: 'smelt iron'
		}
	])
})

test('CommandHandler treats :stop as STOP_CURRENT_GOAL override', t => {
	const bot = new FakeBot()
	const events: unknown[] = []
	const hsm = {
		send: (event: unknown) => {
			events.push(event)
		}
	}

	new CommandHandler(bot, hsm, dependencies(t))
	bot.emit('chat', 'Steve', ':stop')

	assert.deepEqual(events, [
		{
			type: 'STOP_CURRENT_GOAL',
			username: 'Steve'
		}
	])
})

test('CommandHandler ignores empty prefixed command payloads', t => {
	const bot = new FakeBot()
	const events: unknown[] = []
	const hsm = {
		send: (event: unknown) => {
			events.push(event)
		}
	}

	new CommandHandler(bot, hsm, dependencies(t))
	bot.emit('chat', 'Steve', ':')
	bot.emit('chat', 'Steve', '   :   ')

	assert.deepEqual(events, [])
})

test('CommandHandler rejects goals for network-free providers but allows :stop', t => {
	const providers: DisabledAiProvider[] = ['disabled', 'local']
	for (const provider of providers) {
		const bot = new FakeBot()
		const events: UserEvents[] = []
		const hsm = {
			send: (event: UserEvents) => {
				events.push(event)
			}
		}
		new CommandHandler(bot, hsm, dependencies(t, !isAiPilotDisabled(provider)))
		bot.emit('chat', 'Steve', ':collect wood')
		bot.emit('chat', 'Steve', ':stop')

		assert.deepEqual(events, [{ type: 'STOP_CURRENT_GOAL', username: 'Steve' }])
		assert.deepEqual(bot.chatMessages, [AI_PILOT_UNAVAILABLE_COMMAND_MESSAGE])
	}
})

test('CommandHandler ignores own messages and releases its listener once', t => {
	const bot = new FakeBot()
	const events: UserEvents[] = []
	const handler = new CommandHandler(
		bot,
		{ send: event => events.push(event) },
		dependencies(t)
	)
	handler.init()
	assert.equal(bot.listenerCount('chat'), 1)
	bot.emit('chat', bot.username, ':collect wood')
	assert.deepEqual(events, [])
	handler.stop()
	handler.stop()
	assert.equal(bot.listenerCount('chat'), 0)
	bot.emit('chat', 'Steve', ':collect wood')
	assert.deepEqual(events, [])
})
