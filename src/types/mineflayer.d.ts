declare module 'mineflayer' {
	import { EventEmitter } from 'events'
	import { Vec3 } from 'vec3'

	export interface Bot extends EventEmitter {
		username: string
		entity: Entity
		health: number
		food: number
		inventory: any
		pathfinder: any
		pvp: any
		autoEat: any
		// Добавляй по мере необходимости
	}

	export function createBot(options: any): Bot
}

declare module 'mineflayer-pathfinder' {
	// Типы для pathfinder
}
