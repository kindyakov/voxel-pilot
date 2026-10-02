import type { Block } from '@/types/index.js'

import Logger from '@/config/logger.js'

import {
	type BaseServiceState,
	createStatefulService
} from '@/hsm/helpers/createStatefulService.js'
import type { MiningResource } from '@/hsm/tasks/miningResource.js'
import { getMiningTask, sampleMiningInventory } from '@/hsm/tasks/task.js'

import { GoalNear } from '@/modules/plugins/goals.js'

import { equipMiningTool } from '@/utils/minecraft/miningTool.js'

interface PrimitiveBreakingState extends BaseServiceState {
	block: Block | null
}

interface BreakingOptions {
	block: Block | null
	miningResource?: MiningResource
}

const shouldUnequipSword = (
	block: Block,
	heldItemName: string | undefined
): boolean =>
	block.name !== 'cobweb' && heldItemName?.endsWith('_sword') === true

/**
 * Breaks one block and counts it ONLY on inventory growth (Q2).
 * Drop identity is the inventory delta — no raw entity-metadata sniffing (Q10a).
 * After digging the bot steps to the broken position so the drop is picked up,
 * then the delta decides BROKEN vs BREAKING_FAILED (feeds the per-block blacklist, Q6).
 */
export const primitiveBreaking = createStatefulService<
	PrimitiveBreakingState,
	BreakingOptions
>({
	name: 'primitiveBreaking',
	timeoutMs: 30_000,
	initialState: {
		block: null
	},

	onStart: async ({ sendBack, setState, input, bot, abortSignal }) => {
		let { block } = input

		if (!block) {
			Logger.error('❌ primitiveBreaking: No block provided')
			sendBack({ type: 'BREAKING_FAILED', reason: 'No block' })
			return
		}

		setState({ block })

		const fail = (reason: string) => {
			sendBack({ type: 'BREAKING_FAILED', reason })
		}

		try {
			if (abortSignal.aborted) return
			if (input.miningResource) {
				const current = bot.blockAt(block.position)
				if (!current || current.name !== block.name) {
					sendBack({ type: 'MINING_TARGET_CHANGED' })
					return
				}
				block = current
			}

			try {
				if (input.miningResource) {
					await equipMiningTool(bot, block, input.miningResource)
				} else await bot.tool.equipForBlock(block, { requireHarvest: true })
				if (abortSignal.aborted) return

				// mineflayer-tool keeps the held item when its mining speed ties the
				// empty hand. That would waste sword durability on blocks such as sand.
				// Cobweb is the intentional exception: a sword is its mining tool.
				if (shouldUnequipSword(block, bot.heldItem?.name)) {
					await bot.unequip('hand')
				}
			} catch (error) {
				// A cancelled actor must not publish a stale failure either.
				if (abortSignal.aborted) return
				const detail = error instanceof Error ? error.message : String(error)
				if (input.miningResource) {
					sendBack({ type: 'MINING_TOOL_FAILED', reason: detail })
					return
				}
				fail(
					/tool|harvest|equip/i.test(detail)
						? `No harvest tool for ${block.name}`
						: `Equip failed for ${block.name}: ${detail}`
				)
				return
			}

			if (abortSignal.aborted) return
			if (input.miningResource) {
				const current = bot.blockAt(block.position)
				if (!current || current.name !== block.name) {
					sendBack({ type: 'MINING_TARGET_CHANGED' })
					return
				}
				block = current
			}

			if (input.miningResource) {
				const task = getMiningTask(bot.hsm.getContext().taskData)
				const baseline = task?.inventoryBaseline
				if (
					task &&
					baseline &&
					sampleMiningInventory(
						task,
						bot.utils.countItemInInventory(input.miningResource.itemId)
					).collected >= task.count
				) {
					sendBack({ type: 'MINING_INVENTORY_CHANGED' })
					return
				}
			}
			Logger.debug(
				`⛏️ [primitiveBreaking] Breaking ${block.name} at ${block.position}`
			)

			const expectedItemDrop = input.miningResource?.itemId ?? block.drops?.[0]

			if (!expectedItemDrop) {
				Logger.debug(
					'⚠️ [primitiveBreaking] Блока нет в списке дропов, пропускаем сбор'
				)
				await bot.dig(block)
				// A cancelled actor must not publish a stale success.
				if (abortSignal.aborted) return
				sendBack({ type: 'BROKEN' })
				return
			}

			const expectedItemId: number =
				typeof expectedItemDrop === 'number'
					? expectedItemDrop
					: typeof expectedItemDrop.drop === 'number'
						? expectedItemDrop.drop
						: expectedItemDrop.drop.id

			const countBefore = bot.utils.countItemInInventory(expectedItemId)
			Logger.debug(
				`📊 [primitiveBreaking] ${block.name} в инвентаре до копания: ${countBefore}`
			)

			await bot.dig(block)
			Logger.debug(`✅ [primitiveBreaking] Блок сломан: ${block.name}`)

			if (abortSignal.aborted) return

			// Step onto the broken position so the drop is picked up, then judge by delta.
			const { x, y, z } = block.position
			bot.pathfinder.setGoal(new GoalNear(x, y, z, 0.5))

			try {
				await bot.utils.waitForInventoryChange(
					expectedItemId,
					countBefore,
					3000,
					abortSignal
				)
			} finally {
				// A late callback of a cancelled owner must not clear the next
				// owner's goal; cleanup on actor stop already released ours.
				if (!abortSignal.aborted) {
					bot.pathfinder.setGoal(null)
				}
			}
			if (abortSignal.aborted) return

			const countAfter = bot.utils.countItemInInventory(expectedItemId)
			if (countAfter > countBefore) {
				Logger.debug(
					`✅ [primitiveBreaking] Добыто ${block.name} (+${countAfter - countBefore})`
				)
				sendBack({ type: 'BROKEN' })
				return
			}

			Logger.warn(
				`⚠️ [primitiveBreaking] Блок сломан, но дроп не подобран: ${block.name}`
			)
			fail(`Item not collected: ${block.name}`)
		} catch (error) {
			if (abortSignal.aborted) {
				Logger.debug('⚠️ [primitiveBreaking] Aborted')
				return
			}

			Logger.error('❌ [primitiveBreaking] Error', {
				error: error instanceof Error ? error.message : String(error),
				stack: error instanceof Error ? error.stack : undefined
			})
			fail(error instanceof Error ? error.message : 'Unknown error')
		}
	},

	onCleanup: ({ bot }) => {
		Logger.debug('🧹 [primitiveBreaking] Cleanup')
		try {
			try {
				bot.stopDigging()
			} finally {
				bot.pathfinder.setGoal(null)
			}
			Logger.debug('🛑 [primitiveBreaking] Pathfinder остановлен')
		} catch (error) {
			Logger.error('❌ [primitiveBreaking] Ошибка при остановке', {
				error: error instanceof Error ? error.message : String(error),
				stack: error instanceof Error ? error.stack : undefined
			})
		}
	}
})
