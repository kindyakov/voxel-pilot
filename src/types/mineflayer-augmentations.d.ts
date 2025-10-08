import type { EatUtil } from 'mineflayer-auto-eat/dist/new.js'
import type { BotUtils } from '@utils/minecraft/botUtils'
import type BotStateMachine from '@core/hsm'
import type { Pathfinder, Movements } from 'mineflayer-pathfinder'
import type { Entity } from 'prismarine-entity'
import type { Item } from 'prismarine-item'
import type { HawkEye } from 'minecrafthawkeye'

declare module 'mineflayer' {
	export function createBot(options?: any): Bot
	interface Bot {
		// ===== Базовые свойства mineflayer =====
		username: string
		entity: Entity
		entities: Record<string, Entity>
		health: number
		food: number
		foodSaturation: number
		oxygenLevel: number
		inventory: {
			slots: (Item | null)[]
			items: () => Item[]
		}
		registry: {
			isNewerOrEqualTo: (version: string) => boolean
		}

		// ===== Базовые методы mineflayer =====
		loadPlugin(plugin: (bot: Bot) => void): void
		on<K extends keyof BotEvents>(event: K, listener: BotEvents[K]): void
		on(event: string, listener: (...args: any[]) => void): void
		once<K extends keyof BotEvents>(event: K, listener: BotEvents[K]): void
		once(event: string, listener: (...args: any[]) => void): void
		off<K extends keyof BotEvents>(event: K, listener: BotEvents[K]): void
		off(event: string, listener: (...args: any[]) => void): void
		emit<K extends keyof BotEvents>(
			event: K,
			...args: Parameters<BotEvents[K]>
		): void
		emit(event: string, ...args: any[]): void
		chat(message: string): void
		quit(reason?: string): void
		equip(
			item: Item,
			destination: 'hand' | 'head' | 'torso' | 'legs' | 'feet' | 'off-hand'
		): Promise<void>
		consume(): Promise<void>
		nearestEntity(filter?: (entity: Entity) => boolean): Entity | null

		// ===== Плагины =====
		autoEat: EatUtil
		pathfinder: Pathfinder
		movements: Movements
		armorManager: {
			equipAll: () => Promise<void>
		}
		pvp: {
			attack: (entity: Entity) => void
			stop: () => void
			movements: Movements
		}
		hawkEye: HawkEye

		// ===== Утилиты и HSM =====
		utils: BotUtils
		hsm: BotStateMachine
	}

	interface BotEvents {
		spawn: () => void
		end: (reason: string) => void
		error: (err: Error) => void
		botReady: () => void
		botDisconnected: (reason: string) => void
		botError: (error: Error) => void
	}
}
