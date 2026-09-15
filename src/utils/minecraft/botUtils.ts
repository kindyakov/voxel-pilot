import type { Bot, Entity, Item } from '@/types'

import Logger from '@/config/logger'

type Priority = 'none' | 'low' | 'medium' | 'high' | 'critical'

export class BotUtils {
	private _eatingPromise: Promise<void> | null = null

	constructor(private _bot: Bot) {}

	/**
	 * Поиск ближайшего враждебного моба
	 */
	findNearestEnemy(
		maxDistance: number = 20,
		filter: ((entity: Entity) => boolean) | null = null
	): Entity | null {
		const baseFilter = (entity: Entity): boolean => {
			if (!entity || entity.type !== 'hostile') return false

			const botY = this._bot.entity.position.y
			const entityY = entity.position.y
			const yDiff = Math.abs(botY - entityY)

			return (
				yDiff <= 8 &&
				this._bot.entity.position.distanceTo(entity.position) <= maxDistance
			)
		}

		const combined =
			typeof filter === 'function'
				? (e: Entity) => baseFilter(e) && filter(e)
				: baseFilter

		return this._bot.nearestEntity(combined)
	}

	isInventoryFull(threshold: number = 36): boolean {
		return this._bot.inventory.items().length >= threshold
	}

	needsFood(threshold: number = 17): boolean {
		return this._bot.food <= threshold
	}

	needsHealing(health: number = 15): boolean {
		return this._bot.health <= health
	}

	needsSaturation(saturation: number = 1): boolean {
		return this._bot.foodSaturation < saturation
	}

	needsToEat(
		thresholds: { food: number; health: number; saturation: number } = {
			food: 17,
			health: 15,
			saturation: 5
		}
	): {
		shouldEat: boolean
		reasons: string[]
		priority: Priority
		stats: {
			food: number
			health: number
			saturation: number
		}
	} {
		const currentFood = this._bot.food
		const currentHealth = this._bot.health
		const currentSaturation = this._bot.foodSaturation

		const result = {
			shouldEat: false,
			reasons: [] as string[],
			priority: 'none' as Priority,
			stats: {
				food: currentFood,
				health: currentHealth,
				saturation: currentSaturation
			}
		}

		if (currentHealth <= 6) {
			result.shouldEat = true
			result.priority = 'critical'
			result.reasons.push('критическое здоровье')
			return result
		}

		if (
			currentHealth <= thresholds.health &&
			currentSaturation < thresholds.saturation
		) {
			result.shouldEat = true
			result.priority = 'high'
			result.reasons.push('низкое здоровье и насыщение')
			return result
		}

		if (currentFood <= thresholds.food) {
			result.shouldEat = true
			result.priority = 'medium'
			result.reasons.push('голод')
			return result
		}

		if (currentSaturation < thresholds.saturation) {
			result.shouldEat = true
			result.priority = 'low'
			result.reasons.push('низкое насыщение')
		}

		return result
	}

	getMeleeWeapon(): Item | null {
		const weaponItems = [
			'netherite_sword',
			'netherite_axe',
			'diamond_sword',
			'diamond_axe',
			'iron_sword',
			'iron_axe',
			'golden_sword',
			'golden_axe',
			'stone_sword',
			'stone_axe',
			'wooden_sword',
			'wooden_axe'
		] as const

		let weapon = null

		for (const name of weaponItems) {
			weapon =
				this._bot.inventory.items().find((item: Item) => item.name === name) ||
				null
			if (weapon) {
				break
			}
		}

		return weapon
	}

	getRangeWeapon(): Item | null {
		return (
			this._bot.inventory
				.items()
				.find(
					(item: Item) => item.name === 'bow' || item.name === 'crossbow'
				) || null
		)
	}

	getArrow(): Item | null {
		return (
			this._bot.inventory
				.items()
				.find((item: Item) => item.name.includes('arrow')) || null
		)
	}

	searchPlayer(playerName: string = ''): Entity | null {
		return this._bot.nearestEntity(
			(e: Entity) => e.name === playerName || e.type === 'player'
		)
	}

	getAllItems(): Item[] {
		const items = this._bot.inventory.items()

		const offhandItem = this._bot.inventory.slots[45]
		if (this._bot.registry.isNewerOrEqualTo('1.9') && offhandItem) {
			items.push(offhandItem)
		}

		return items
	}

	getAllFood(): Item[] {
		return this.getAllItems()
			.filter(item => this._bot.autoEat.foodsByName[item.name])
			.filter(item => !this._bot.autoEat.opts.bannedFood.includes(item.name))
	}

	/** Performs one eating attempt; the active survival actor owns retries. */
	async eating(): Promise<void> {
		if (this._eatingPromise) return this._eatingPromise
		if (this._bot.food >= 20 || this._bot.autoEat.isEating) return

		const foodChoices = this._bot.autoEat.findBestChoices(
			this.getAllItems(),
			'saturation'
		)
		const bestFood = foodChoices[0]
		if (!bestFood) throw new Error('No suitable food available for recovery')

		const attempt = this._bot.autoEat.eat({
			food: bestFood,
			priority: 'saturation',
			offhand: false,
			equipOldItem: true
		})
		this._eatingPromise = attempt
		try {
			await attempt
		} finally {
			if (this._eatingPromise === attempt) this._eatingPromise = null
		}
	}

	stopEating(): void {
		if (this._bot.autoEat.isEating) this._bot.autoEat.cancelEat()
	}

	/**
	 * Подсчитывает количество предметов определённого типа в инвентаре
	 * @param itemId - ID предмета (например, block.drops[0])
	 * @returns Общее количество предметов
	 */
	countItemInInventory(itemId: number): number {
		let total = 0
		const items = this._bot.inventory.items()

		for (const item of items) {
			if (item.type === itemId) {
				total += item.count
			}
		}

		return total
	}

	/**
	 * Ожидает изменения количества предмета в инвентаре
	 * @param itemId - ID предмета
	 * @param initialCount - Начальное количество
	 * @param timeout - Таймаут в мс
	 * @returns true если количество увеличилось, false если таймаут
	 */
	waitForInventoryChange(
		itemId: number,
		initialCount: number,
		timeout: number = 3000,
		signal?: AbortSignal
	): Promise<boolean> {
		return new Promise((resolve, reject) => {
			if (signal?.aborted) {
				reject(signal.reason)
				return
			}
			const startTime = Date.now()
			const finish = (collected: boolean) => {
				clearInterval(checkInterval)
				signal?.removeEventListener('abort', abort)
				resolve(collected)
			}
			const abort = () => {
				clearInterval(checkInterval)
				signal?.removeEventListener('abort', abort)
				reject(signal?.reason)
			}

			const checkInterval = setInterval(() => {
				const currentCount = this.countItemInInventory(itemId)

				// Проверяем увеличилось ли количество
				if (currentCount > initialCount) {
					finish(true)
					return
				}

				// Проверяем таймаут
				if (Date.now() - startTime >= timeout) {
					finish(false)
				}
			}, 100) // Проверка каждые 100мс
			signal?.addEventListener('abort', abort, { once: true })
		})
	}

	/**
	 * Проверяет есть ли в инвентаре хотя бы один предмет определённого типа
	 */
	hasItemInInventory(itemId: number): boolean {
		return this.countItemInInventory(itemId) > 0
	}

	/**
	 * Проверяет есть ли свободное место в инвентаре
	 */
	hasInventorySpace(): boolean {
		// Проверяем слоты с 9 по 44 (инвентарь игрока)
		for (let i = 9; i <= 44; i++) {
			if (!this._bot.inventory.slots[i]) {
				return true
			}
		}
		return false
	}
}
