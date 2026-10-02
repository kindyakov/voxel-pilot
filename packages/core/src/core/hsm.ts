import type { Bot } from '@/types/index.js'

import Config from '@/config/config.js'
import Logger from '@/config/logger.js'

import { runAgentTurn } from '@/ai/loop.js'
import { isAiPilotDisabled } from '@/ai/pilotAvailability.js'

import {
	type BotStateMachineOptions,
	BotStateMachine as InstanceBotStateMachine
} from './harness.js'

/** @deprecated Temporary bootstrap adapter; #26 passes dependencies to core/harness.ts. */
class BotStateMachine extends InstanceBotStateMachine {
	constructor(bot: Bot, options: BotStateMachineOptions = {}) {
		super(
			bot,
			{
				logger: Logger,
				runAgentTurn,
				aiPilotEnabled: !isAiPilotDisabled(Config.ai.provider),
				minecraftVersion: Config.minecraft.version,
				diagnosticsEnabled: true
			},
			options
		)
	}
}

export default BotStateMachine
