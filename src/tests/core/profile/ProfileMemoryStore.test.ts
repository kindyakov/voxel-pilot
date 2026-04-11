import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { ProfileMemoryStore } from '../../../core/profile/index.js'

const createTempDataDir = async (): Promise<string> =>
	fs.mkdtemp(path.join(os.tmpdir(), 'minecraft-bot-profile-'))

test('ProfileMemoryStore persists user profile prompt fields in a dedicated store', async () => {
	const dataDir = await createTempDataDir()
	const store = new ProfileMemoryStore({
		botName: 'TestBot',
		dataDir
	})

	await store.load()

	assert.deepEqual(store.getProfilePrompt(), {
		persona: null,
		style: null,
		defaultLanguage: null,
		selfDescription: null,
		tone: null,
		behaviorPreferences: []
	})

	store.updateProfilePrompt({
		persona: 'Mining assistant',
		defaultLanguage: 'ru',
		tone: 'brief',
		behaviorPreferences: ['Prefer direct answers']
	})
	store.close()

	const reloaded = new ProfileMemoryStore({
		botName: 'TestBot',
		dataDir
	})
	await reloaded.load()

	assert.deepEqual(reloaded.getProfilePrompt(), {
		persona: 'Mining assistant',
		style: null,
		defaultLanguage: 'ru',
		selfDescription: null,
		tone: 'brief',
		behaviorPreferences: ['Prefer direct answers']
	})

	reloaded.close()
})
