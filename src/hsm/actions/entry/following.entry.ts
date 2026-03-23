import type { FollowingTaskData } from '@hsm/tasks/types'
import type { MachineActionParams } from '@hsm/types'

/**
 * Entry action для FOLLOWING
 */
const entryFollowing = ({ context }: MachineActionParams) => {
	const bot = context.bot
	if (!bot) {
		console.error('❌ [entryFollowing] Bot не инициализирован')
		return
	}

	const taskData = context.taskData as FollowingTaskData
	const targetInfo = taskData.entityName
		? `существо ${taskData.entityName}`
		: taskData.entityType
			? `существо типа ${taskData.entityType}`
			: 'неизвестную цель'

	console.log(
		`🏃 [FOLLOWING] Вход в состояние FOLLOWING: следование за ${targetInfo}`
	)
}

/**
 * Entry action для SEARCHING_TARGET
 */
const entrySearchingTarget = ({ context }: MachineActionParams) => {
	const bot = context.bot
	if (!bot) {
		console.error('❌ [entrySearchingTarget] Bot не инициализирован')
		return
	}

	const taskData = context.taskData as FollowingTaskData

	const targetInfo = taskData.entityName
		? `существо ${taskData.entityName}`
		: taskData.entityType
			? `существо типа ${taskData.entityType}`
			: 'неизвестную цель'

	console.log(`🔍 [FOLLOWING] Поиск цели: ${targetInfo}`)
}

/**
 * Entry action для FOLLOWING_TARGET
 */
const entryFollowingTarget = ({ context }: MachineActionParams) => {
	const bot = context.bot
	if (!bot) {
		console.error('❌ [entryFollowingTarget] Bot не инициализирован')
		return
	}

	const taskData = context.taskData as FollowingTaskData
	if (!taskData.targetEntity) {
		console.warn('⚠️ [entryFollowingTarget] Цель не найдена в taskData')
		return
	}

	const entityName =
		taskData.targetEntity.username ||
		taskData.targetEntity.name ||
		taskData.targetEntity.displayName ||
		'неизвестная сущность'
	const distance = taskData.distance || 3

	console.log(
		`🎯 [FOLLOWING] Начало следования за "${entityName}" на дистанции ${distance} блоков`
	)
}

/**
 * Entry action для TASK_COMPLETED
 */
const taskFollowingCompleted = ({ context }: MachineActionParams) => {
	const bot = context.bot
	if (!bot) {
		console.error('❌ [taskFollowingCompleted] Bot не инициализирован')
		return
	}

	const taskData = context.taskData as FollowingTaskData | null
	console.log('✅ [FOLLOWING] Задача завершена: следование остановлено')

	// Очистить context.taskData
	context.taskData = null
}

/**
 * Entry action для TASK_FAILED
 */
const taskFollowingFailed = ({ context }: MachineActionParams) => {
	const bot = context.bot
	if (!bot) {
		console.error('❌ [taskFollowingFailed] Bot не инициализирован')
		return
	}

	const taskData = context.taskData as FollowingTaskData | null
	const targetInfo = taskData
		? taskData.entityName || taskData.entityType || 'неизвестная цель'
		: 'неизвестная цель'

	console.log(
		`❌ [FOLLOWING] Задача провалена: не удалось найти/следовать за ${targetInfo}`
	)

	// Очистить context.taskData
	context.taskData = null
}

export default {
	entryFollowing,
	entrySearchingTarget,
	entryFollowingTarget,
	taskFollowingCompleted,
	taskFollowingFailed
}
