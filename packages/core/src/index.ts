// Import and construction are inert; callers supply services and explicitly start.
export { default as MinecraftBot } from './core/bot.js'
export type { ConnectionDependencies } from './core/bot.js'
export { createBotRuntime } from './core/runtime.js'
export type { BotRuntimeOptions } from './core/runtime.js'
