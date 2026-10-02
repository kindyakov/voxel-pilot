import { createRuntimeLogger } from '@/config/runtimeLogger.js'

import type { HarnessDependencies } from '@/hsm/dependencies.js'
import { createBotMachine as createInstanceMachine } from '@/hsm/machine.js'
import type { MachineFactoryOptions } from '@/hsm/machine.js'

import { runAgentTurn } from '@/ai/loop.js'

// Quiet fixture sink only. Production factories always receive their owner dependencies.
export const fixtureLogger = createRuntimeLogger({
	aiModel: 'hsm-fixture-model',
	console: false,
	files: false
}).logger

export const testHarnessDependencies = (
	overrides: Partial<HarnessDependencies> = {}
): HarnessDependencies => ({
	logger: fixtureLogger,
	runAgentTurn,
	aiPilotEnabled: true,
	minecraftVersion: '1.20.4',
	diagnosticsEnabled: false,
	...overrides
})

export const createBotMachine = (options?: MachineFactoryOptions) =>
	createInstanceMachine(testHarnessDependencies(), options)
