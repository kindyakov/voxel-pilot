import type { Bot } from '@/types/index.js'

import Logger from '@/config/logger.js'

import { createConnectionInitializer } from './runtimeConnection.js'

/** @deprecated Compatibility for the old lifecycle; use an explicit initializer. */
export const initConnection = (bot: Bot): (() => void) =>
	createConnectionInitializer(Logger)(bot)
