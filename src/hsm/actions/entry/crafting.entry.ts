import type { MachineActionParams } from '@hsm/types'
import type { CraftingTaskData } from '@hsm/tasks/types'

/**
 * Entry action для CRAFTING
 */
const entryCrafting = ({ context }: MachineActionParams) => {
	const bot = context.bot
	if (!bot) {
		console.error('❌ [entryCrafting] Bot не инициализирован')
		return
	}

	const taskData = context.taskData as CraftingTaskData
	console.log(`🔨 [CRAFTING] Вход в состояние CRAFTING: крафт ${taskData.recipe} x${taskData.count}`)
}

/**
 * Entry action для CHECKING_RECIPE
 */
const entryCheckingRecipe = ({ context }: MachineActionParams) => {
	const bot = context.bot
	if (!bot) {
		console.error('❌ [entryCheckingRecipe] Bot не инициализирован')
		return
	}

	const taskData = context.taskData as CraftingTaskData
	console.log(`🔍 [CRAFTING] Проверка рецепта для ${taskData.recipe}`)
}

/**
 * Entry action для TASK_COMPLETED
 */
const taskCraftingCompleted = ({ context }: MachineActionParams) => {
	const bot = context.bot
	if (!bot) {
		console.error('❌ [taskCraftingCompleted] Bot не инициализирован')
		return
	}

	const taskData = context.taskData as CraftingTaskData | null
	if (!taskData) {
		console.warn('⚠️ [taskCraftingCompleted] Нет taskData')
		return
	}

	console.log(
		`✅ [CRAFTING] Задача завершена: скрафчено ${taskData.crafted}/${taskData.count}`
	)

	// Очистить context.taskData
	context.taskData = null
}

/**
 * Entry action для TASK_FAILED
 */
const taskCraftingFailed = ({ context }: MachineActionParams) => {
	const bot = context.bot
	if (!bot) {
		console.error('❌ [taskCraftingFailed] Bot не инициализирован')
		return
	}

	const taskData = context.taskData as CraftingTaskData | null
	console.log('❌ [CRAFTING] Задача провалена!')

	// Очистить context.taskData
	context.taskData = null
}

export default {
	entryCrafting,
	entryCheckingRecipe,
	taskCraftingCompleted,
	taskCraftingFailed
}
