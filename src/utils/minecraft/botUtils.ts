import { Item, Bot, Entity } from '../../types'
import 'mineflayer-auto-eat'

type Priority = 'none' | 'low' | 'medium' | 'high' | 'critical'

export class BotUtils {
	private _eatingTimeoutId: NodeJS.Timeout | null = null // таймер для кушания

	constructor(private _bot: Bot) {}

	/**
	 * Поиск ближайшего враждебного моба
	 */
	findNearestEnemy(
		maxDistance: number = 15,
		filter: ((entity: Entity) => boolean) | null = null
	): Entity | null {
		const baseFilter = (entity: Entity): boolean => {
			if (!entity || entity.type !== 'hostile') return false

			const botY = this._bot.entity.position.y
			const entityY = entity.position.y
			const yDiff = Math.abs(botY - entityY)

			// Сначала проверяем высоту (быстрее), потом общую дистанцию
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

	/**
	 * Проверка заполненности инвентаря
	 * @param {number} threshold - порог заполненности (по умолчанию полный)
	 * @returns {boolean} true если инвентарь заполнен
	 */
	isInventoryFull(threshold: number = 36): boolean {
		return this._bot.inventory.items().length >= threshold
	}

	/**
	 * Проверка необходимости еды
	 * @param {number} threshold - порог голода
	 * @returns {boolean} true если нужно есть
	 */
	needsFood(threshold: number = 17): boolean {
		return this._bot.food <= threshold
	}

	/**
	 * Проверка необходимости лечения
	 * @param {number} health - порог здоровья
	 * @returns {boolean} true если нужно лечение
	 */
	needsHealing(health: number = 15): boolean {
		return this._bot.health <= health
	}

	/**
	 * Проверка необходимости лечения
	 * @param {number} saturation - порог сытости
	 * @returns {boolean} true если нужно есть
	 */
	needsSaturation(saturation: number = 1): boolean {
		return this._bot.foodSaturation < saturation
	}

	/**
	 * Комплексная проверка необходимости питания
	 * @param {Object} thresholds - пороги для проверки
	 * @returns {Object} объект с детальной информацией о необходимости питания
	 */
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

		// Критическое состояние - здоровье очень низкое
		if (currentHealth <= 6) {
			result.shouldEat = true
			result.priority = 'critical'
			result.reasons.push('критическое здоровье')
			return result
		}

		// Высокий приоритет - низкое здоровье + низкое насыщение
		if (
			currentHealth <= thresholds.health &&
			currentSaturation < thresholds.saturation
		) {
			result.shouldEat = true
			result.priority = 'high'
			result.reasons.push('низкое здоровье и насыщение')
			return result
		}

		// Средний приоритет - просто голод
		if (currentFood <= thresholds.food) {
			result.shouldEat = true
			result.priority = 'medium'
			result.reasons.push('голод')
			return result
		}

		// Низкий приоритет - только насыщение
		if (currentSaturation < thresholds.saturation) {
			result.shouldEat = true
			result.priority = 'low'
			result.reasons.push('низкое насыщение')
		}

		return result
	}

	/**
	 * Поиск оружия в инвентаре
	 * @returns {Object|null} оружие или null
	 */
	getMeleeWeapon(): Item | null {
		const weaponItems = [
			'netherite_sword', // незеритовый меч
			'netherite_axe', // незеритовый топор
			'diamond_sword', // алмазный меч
			'diamond_axe', // алмазный топор
			'iron_sword', // железный меч
			'iron_axe', // железный топор
			'golden_sword', // золотой меч
			'golden_axe', // золотой топор
			'stone_sword', // каменный меч
			'stone_axe', // каменный топор
			'wooden_sword', // деревянный меч
			'wooden_axe' // деревянный топор
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
					(item: Item) =>
						item.name.includes('bow') || item.name.includes('crossbow')
				) || null
		)
	}

	getArrow(): Item | null {
		return (
			this._bot.inventory.items().find(item => item.name.includes('arrow')) ||
			null
		)
	}

	searchPlayer(playerName: string = ''): Entity | null {
		return this._bot.nearestEntity(
			e => e.name === playerName || e.type === 'player'
		)
	}

	getAllItems(): Item[] {
		const items = this._bot.inventory.items()

		// Добавляем предмет из offhand если он существует
		const offhandItem = this._bot.inventory.slots[45]
		if (this._bot.registry.isNewerOrEqualTo('1.9') && offhandItem) {
			items.push(offhandItem)
		}

		return items
	}

	// Функция для поиска еды включая offhand
	getAllFood(): Item[] {
		return this.getAllItems()
			.filter(item => this._bot.autoEat.foodsByName[item.name])
			.filter(item => !this._bot.autoEat.opts.bannedFood.includes(item.name))
	}

	// Для еды
	async eating(): Promise<void> {
		if (!this._bot || this._bot?.health === 20) {
			this.stopEating()
			return
		}

		try {
			if (this._bot.food >= 20) {
				console.log('Голод полный, жду регенерации здоровья...')
				this.stopEating() // Очищаем предыдущий
				this._eatingTimeoutId = setTimeout(() => this.eating(), 1500)
				return
			}

			console.log('Ищу еду в инвентаре...')

			const allItems = this.getAllItems()
			const foodChoices = this._bot.autoEat.findBestChoices(
				allItems,
				'saturation'
			)

			if (!foodChoices.length) {
				this._bot.chat('Нет еды в инвентаре критическая ситуация!')
				return
			}

			const bestFood = foodChoices[0]!
			console.log(`Выбрал еду: ${bestFood.name}`)

			await this._bot.equip(bestFood, 'hand')

			if (this._bot.autoEat.isEating) return

			console.log('🍖 Начинаю есть...')
			await this._bot.consume()

			console.log(
				`Поел! HP: ${this._bot.health.toFixed(1)}, Food: ${this._bot.food}, Saturation: ${this._bot.foodSaturation.toFixed(1)}`
			)

			if (this._bot.health < 20) {
				this.stopEating()
				this._eatingTimeoutId = setTimeout(() => this.eating(), 1500)
			}
		} catch (error) {
			const errorMessage =
				error instanceof Error ? error.message : String(error)
			console.log(`Ошибка при еде: ${errorMessage}`)
			if (this._bot.health < 20) {
				this.stopEating()
				this._eatingTimeoutId = setTimeout(() => this.eating(), 1500)
			}
		}
	}

	stopEating(): void {
		if (this._eatingTimeoutId) {
			clearTimeout(this._eatingTimeoutId)
			this._eatingTimeoutId = null
		}
	}
}
