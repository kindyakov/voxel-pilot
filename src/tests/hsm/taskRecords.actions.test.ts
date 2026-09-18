import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import type { Bot } from '@/types/index.js'

import Logger from '@/config/logger.js'

import { MemoryManager } from '@/core/memory/index.js'
import type {
	CreatePersistentTaskInput,
	PersistentTaskRecord
} from '@/core/memory/types.js'

import {
	computeTaskCancel,
	computeTaskStart,
	enterTaskRecord,
	syncTerminalRecord,
	taskRecordActions
} from '@/hsm/actions/taskRecords.actions.js'
import { context as initialContext } from '@/hsm/context.js'
import type { MachineContext } from '@/hsm/context.js'
import { createMiningTask } from '@/hsm/tasks/task.js'

import { createGoalExecution } from '@/ai/goalExecution.js'
import { parseExecution } from '@/ai/tools/executionDefinitions.js'

import { HandoffBot } from './fixtures/handoffBot.js'

const createTaskMemory = async (): Promise<{
	memory: MemoryManager
	cleanup: () => void
}> => {
	const dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), 'voxel-pilot-taskops-')
	)
	const memory = new MemoryManager({ botName: 'OpsBot', dataDir })
	await memory.load()
	return { memory, cleanup: () => memory.close() }
}

const taskExecution = (name: string, args: unknown) => {
	const parsed = parseExecution(name, args)
	if (!parsed.ok) {
		throw new Error(`Bad task fixture: ${parsed.reason}`)
	}
	return parsed.execution
}

const botWith = (memory: MemoryManager): Bot => {
	const bot = new HandoffBot()
	bot.memory = memory
	return bot.asBot()
}

type TaskMemoryOverrides = Partial<
	Pick<
		MemoryManager,
		'createTask' | 'getTask' | 'updateTaskProgress' | 'setTaskStatus'
	>
>

const memoryWith = (
	memory: MemoryManager,
	overrides: TaskMemoryOverrides
): MemoryManager =>
	new Proxy(memory, {
		get(target, property) {
			if (property === 'createTask' && overrides.createTask) {
				return overrides.createTask
			}
			if (property === 'getTask' && overrides.getTask) {
				return overrides.getTask
			}
			if (property === 'updateTaskProgress' && overrides.updateTaskProgress) {
				return overrides.updateTaskProgress
			}
			if (property === 'setTaskStatus' && overrides.setTaskStatus) {
				return overrides.setTaskStatus
			}
			const value = Reflect.get(target, property, target)
			return typeof value === 'function' ? value.bind(target) : value
		}
	})

const contextWith = (fields: Partial<MachineContext>): MachineContext => ({
	...initialContext,
	taskData: null,
	errorHistory: [],
	goalExecution: createGoalExecution(),
	lastAction: null,
	lastActionArgs: null,
	lastResult: null,
	lastReason: null,
	lastToolTranscript: [],
	pendingExecution: null,
	...fields
})

test('enterTaskRecord links an unlinked task as active', async () => {
	const { memory, cleanup } = await createTaskMemory()
	try {
		const linked = enterTaskRecord(
			contextWith({
				taskData: createMiningTask('iron_ore', 3),
				bot: botWith(memory)
			})
		)

		assert.ok(linked?.taskId)
		assert.equal(memory.getTask(linked!.taskId!)?.status, 'active')
	} finally {
		cleanup()
	}
})

test('enterTaskRecord reactivates a suspended row instead of duplicating it', async () => {
	const { memory, cleanup } = await createTaskMemory()
	try {
		const record = memory.createTask({
			kind: 'mining',
			blockName: 'iron_ore',
			total: 4
		})
		memory.updateTaskProgress(record.id, 2, { status: 'suspended' })

		const resumed = enterTaskRecord(
			contextWith({
				taskData: { ...createMiningTask('iron_ore', 4), taskId: record.id },
				bot: botWith(memory)
			})
		)

		assert.equal(resumed?.taskId, record.id)
		assert.equal(memory.getTask(record.id)?.status, 'active')
		assert.equal(memory.listTasks().length, 1)
	} finally {
		cleanup()
	}
})

test('enterTaskRecord failure-marks the task instead of running unlinked', async () => {
	const { memory, cleanup } = await createTaskMemory()
	try {
		const broken = memoryWith(memory, {
			createTask: () => {
				throw new Error('disk full')
			}
		})
		const marked = enterTaskRecord(
			contextWith({
				taskData: createMiningTask('iron_ore', 3),
				bot: botWith(broken)
			})
		)

		assert.equal(marked?.taskId, null)
		assert.match(marked?.lastFailure ?? '', /Task record link failed/)
	} finally {
		cleanup()
	}
})

test('computeTaskCancel releases an orphaned active row', async () => {
	const { memory, cleanup } = await createTaskMemory()
	try {
		const record = memory.createTask({
			kind: 'mining',
			blockName: 'iron_ore',
			total: 4
		})
		memory.setTaskStatus(record.id, 'active')

		const outcome = computeTaskCancel(
			contextWith({
				bot: botWith(memory),
				pendingExecution: taskExecution('tasks_cancel', {
					task_id: record.id
				})
			})
		)

		assert.equal(outcome.lastResult, 'SUCCESS')
		assert.equal(memory.getTask(record.id)?.status, 'cancelled')
	} finally {
		cleanup()
	}
})

test('computeTaskCancel reports a vanished row instead of succeeding', async () => {
	const { memory, cleanup } = await createTaskMemory()
	try {
		const record = memory.createTask({
			kind: 'mining',
			blockName: 'iron_ore',
			total: 4
		})
		const outcome = computeTaskCancel(
			contextWith({
				bot: botWith(
					memoryWith(memory, {
						setTaskStatus: () => null,
						getTask: (id: string) => memory.getTask(id)
					})
				),
				pendingExecution: taskExecution('tasks_cancel', {
					task_id: record.id
				})
			})
		)

		assert.equal(outcome.lastResult, 'FAILED')
		assert.match(outcome.lastReason ?? '', /record is gone/)
	} finally {
		cleanup()
	}
})

test('computeTaskStart fails when activation writes nothing', async () => {
	const { memory, cleanup } = await createTaskMemory()
	try {
		const record = memory.createTask({
			kind: 'mining',
			blockName: 'iron_ore',
			total: 4
		})
		const outcome = computeTaskStart(
			contextWith({
				bot: botWith(
					memoryWith(memory, {
						setTaskStatus: () => null,
						getTask: (id: string) => memory.getTask(id)
					})
				),
				pendingExecution: taskExecution('tasks_start', {
					task_id: record.id
				})
			})
		)

		assert.equal(outcome.lastResult, 'FAILED')
		assert.match(outcome.lastReason ?? '', /record is gone/)
	} finally {
		cleanup()
	}
})

test('computeTaskStart rejects a row fetched for another id', async () => {
	const { memory, cleanup } = await createTaskMemory()
	try {
		const record = memory.createTask({
			kind: 'mining',
			blockName: 'iron_ore',
			total: 4
		})
		const outcome = computeTaskStart(
			contextWith({
				bot: botWith(
					memoryWith(memory, {
						getTask: () => ({ ...memory.getTask(record.id)!, id: 'row-b' })
					})
				),
				pendingExecution: taskExecution('tasks_start', {
					task_id: record.id
				})
			})
		)

		assert.equal(outcome.lastResult, 'FAILED')
		assert.match(outcome.lastReason ?? '', /mismatch/)
	} finally {
		cleanup()
	}
})

test('computeTaskCancel rejects a row fetched for another id', async () => {
	const { memory, cleanup } = await createTaskMemory()
	try {
		const record = memory.createTask({
			kind: 'mining',
			blockName: 'iron_ore',
			total: 4
		})
		const outcome = computeTaskCancel(
			contextWith({
				bot: botWith(
					memoryWith(memory, {
						getTask: () => ({ ...memory.getTask(record.id)!, id: 'row-b' })
					})
				),
				pendingExecution: taskExecution('tasks_cancel', {
					task_id: record.id
				})
			})
		)

		assert.equal(outcome.lastResult, 'FAILED')
		assert.match(outcome.lastReason ?? '', /mismatch/)
		assert.equal(memory.getTask(record.id)?.status, 'suspended')
	} finally {
		cleanup()
	}
})

test('enterTaskRecord rejects a reactivation answer for another id', async () => {
	const { memory, cleanup } = await createTaskMemory()
	try {
		const record = memory.createTask({
			kind: 'mining',
			blockName: 'iron_ore',
			total: 4
		})
		const marked = enterTaskRecord(
			contextWith({
				taskData: { ...createMiningTask('iron_ore', 4), taskId: record.id },
				bot: botWith(
					memoryWith(memory, {
						getTask: () => ({ ...memory.getTask(record.id)!, id: 'row-b' })
					})
				)
			})
		)

		assert.equal(marked?.taskId, null)
		assert.match(marked?.lastFailure ?? '', /mismatch/)
	} finally {
		cleanup()
	}
})

test('sync mismatch is diagnosed via Logger.error, not silence', async t => {
	const { memory, cleanup } = await createTaskMemory()
	try {
		const record = memory.createTask({
			kind: 'mining',
			blockName: 'iron_ore',
			total: 4
		})
		memory.setTaskStatus(record.id, 'active')
		const errors: unknown[][] = []
		t.mock.method(Logger, 'error', (...args: unknown[]) => {
			errors.push(args)
		})

		const doctors: Array<(row: PersistentTaskRecord) => PersistentTaskRecord> =
			[
				row => ({ ...row, id: 'row-b' }),
				row => ({ ...row, status: 'completed' }),
				row => ({ ...row, done: 999 })
			]
		for (const doctor of doctors) {
			taskRecordActions.persistSuspendedTask({
				context: contextWith({
					taskData: {
						...createMiningTask('iron_ore', 4),
						taskId: record.id,
						collected: 2
					},
					bot: botWith(
						memoryWith(memory, {
							getTask: (id: string) => memory.getTask(id),
							updateTaskProgress: () =>
								doctor({ ...memory.getTask(record.id)! })
						})
					)
				})
			})
		}

		const mismatch = errors.filter(args =>
			String(args[0]).includes('record sync mismatch')
		)
		assert.equal(mismatch.length, 3)
		// Nothing was written through: the real row is untouched.
		assert.equal(memory.getTask(record.id)?.done, 0)
		assert.equal(memory.getTask(record.id)?.status, 'active')
	} finally {
		cleanup()
	}
})

test('persistSuspendedTask ignores a mismatched sync answer without writing', async () => {
	const { memory, cleanup } = await createTaskMemory()
	try {
		const record = memory.createTask({
			kind: 'mining',
			blockName: 'iron_ore',
			total: 4
		})
		memory.setTaskStatus(record.id, 'active')

		taskRecordActions.persistSuspendedTask({
			context: contextWith({
				taskData: {
					...createMiningTask('iron_ore', 4),
					taskId: record.id,
					collected: 2
				},
				bot: botWith(
					memoryWith(memory, {
						getTask: (id: string) => memory.getTask(id),
						updateTaskProgress: () => ({
							...memory.getTask(record.id)!,
							id: 'row-b'
						})
					})
				)
			})
		})

		assert.equal(memory.getTask(record.id)?.done, 0)
		assert.equal(memory.getTask(record.id)?.status, 'active')
	} finally {
		cleanup()
	}
})

test('enterTaskRecord never activates a mismatched created row', async () => {
	const { memory, cleanup } = await createTaskMemory()
	try {
		let activations = 0
		const broken = botWith(
			memoryWith(memory, {
				createTask: () => ({
					...memory.createTask({
						kind: 'mining',
						blockName: 'dirt',
						total: 9
					})
				}),
				setTaskStatus: () => {
					activations += 1
					return null
				},
				getTask: (id: string) => memory.getTask(id)
			})
		)
		const marked = enterTaskRecord(
			contextWith({
				taskData: createMiningTask('iron_ore', 3),
				bot: broken
			})
		)

		assert.equal(marked?.taskId, null)
		assert.match(marked?.lastFailure ?? '', /mismatch after create/)
		assert.equal(activations, 0)
	} finally {
		cleanup()
	}
})

test('syncTerminalRecord fails closed without a linked row or memory', async () => {
	const { memory, cleanup } = await createTaskMemory()
	try {
		const unlinked = syncTerminalRecord(
			contextWith({
				taskData: createMiningTask('iron_ore', 3),
				bot: botWith(memory)
			})
		)
		assert.equal(unlinked?.taskId, null)
		assert.match(unlinked?.lastFailure ?? '', /unavailable for terminal sync/)

		const record = memory.createTask({
			kind: 'mining',
			blockName: 'iron_ore',
			total: 3
		})
		const noMemory = syncTerminalRecord(
			contextWith({
				taskData: { ...createMiningTask('iron_ore', 3), taskId: record.id },
				bot: null
			})
		)
		assert.match(noMemory?.lastFailure ?? '', /unavailable for terminal sync/)
		assert.equal(syncTerminalRecord(contextWith({ taskData: null })), null)
	} finally {
		cleanup()
	}
})

test('fire-and-forget sync reports missing record prerequisites', async t => {
	const { memory, cleanup } = await createTaskMemory()
	try {
		const errors: unknown[][] = []
		t.mock.method(Logger, 'error', (...args: unknown[]) => {
			errors.push(args)
		})

		taskRecordActions.persistProgressTask({
			context: contextWith({
				taskData: createMiningTask('iron_ore', 3),
				bot: botWith(memory)
			})
		})
		taskRecordActions.persistSuspendedTask({
			context: contextWith({
				taskData: {
					...createMiningTask('iron_ore', 3),
					taskId: 'missing-memory'
				},
				bot: null
			})
		})

		const prerequisites = errors.filter(args =>
			String(args[0]).includes('record sync prerequisites unavailable')
		)
		assert.equal(prerequisites.length, 2)
		assert.deepEqual(prerequisites[0]?.[1], {
			taskId: null,
			hasMemory: true,
			status: null,
			onlyFrom: 'active',
			done: 0
		})
		assert.deepEqual(prerequisites[1]?.[1], {
			taskId: 'missing-memory',
			hasMemory: false,
			status: 'suspended',
			onlyFrom: 'active',
			done: 0
		})
	} finally {
		cleanup()
	}
})

test('enterTaskRecord rejects an activation echo with corrupted payload', async () => {
	const { memory, cleanup } = await createTaskMemory()
	try {
		const marked = enterTaskRecord(
			contextWith({
				taskData: createMiningTask('iron_ore', 3),
				bot: botWith(
					memoryWith(memory, {
						createTask: (input: CreatePersistentTaskInput) =>
							memory.createTask(input),
						getTask: (id: string) => memory.getTask(id),
						setTaskStatus: (id: string) => ({
							...memory.getTask(id)!,
							status: 'active',
							blockName: 'dirt'
						})
					})
				)
			})
		)

		assert.equal(marked?.taskId, null)
		assert.match(marked?.lastFailure ?? '', /activation failed/)
	} finally {
		cleanup()
	}
})

test('suspend pre-read classifies missing, foreign and unexpected rows', async t => {
	const { memory, cleanup } = await createTaskMemory()
	try {
		const record = memory.createTask({
			kind: 'mining',
			blockName: 'iron_ore',
			total: 4
		})
		memory.setTaskStatus(record.id, 'active')
		const errors: string[] = []
		const debugs: string[] = []
		t.mock.method(Logger, 'error', (message: string) => {
			errors.push(String(message))
		})
		t.mock.method(Logger, 'debug', (message: string) => {
			debugs.push(String(message))
		})
		let writes = 0
		const suspendWith = (
			getTask: (id: string) => PersistentTaskRecord | null
		) => {
			taskRecordActions.persistSuspendedTask({
				context: contextWith({
					taskData: {
						...createMiningTask('iron_ore', 4),
						taskId: record.id,
						collected: 2
					},
					bot: botWith(
						memoryWith(memory, {
							getTask,
							updateTaskProgress: (
								...args: Parameters<MemoryManager['updateTaskProgress']>
							) => {
								writes += 1
								return memory.updateTaskProgress(...args)
							}
						})
					)
				})
			})
		}

		suspendWith(() => null)
		assert.ok(errors.some(message => message.includes('gone or foreign')))
		suspendWith((id: string) => ({ ...memory.getTask(id)!, id: 'row-b' }))
		assert.ok(errors.some(message => message.includes('gone or foreign')))
		suspendWith((id: string) => ({
			...memory.getTask(id)!,
			status: 'suspended'
		}))
		assert.ok(
			errors.some(message => message.includes('unexpected nonterminal'))
		)
		assert.equal(writes, 0)

		suspendWith((id: string) => ({
			...memory.getTask(id)!,
			status: 'completed'
		}))
		// A terminal race is expected: debug only, no integrity error.
		assert.ok(debugs.some(message => message.includes('already moved on')))
		assert.ok(errors.every(message => !message.includes('already moved on')))

		const debugCount = debugs.length
		suspendWith((id: string) => ({
			...memory.getTask(id)!,
			status: 'completed',
			blockName: 'dirt'
		}))
		assert.ok(errors.some(message => message.includes('task payload mismatch')))
		assert.equal(debugs.length, debugCount)
		// Nothing was ever written through in any branch above.
		assert.equal(writes, 0)
		// The completed row is left alone.
		assert.equal(memory.getTask(record.id)?.status, 'active')
		assert.equal(memory.getTask(record.id)?.done, 0)
	} finally {
		cleanup()
	}
})

test('enterTaskRecord rejects resume over corrupt saved progress', async () => {
	const { memory, cleanup } = await createTaskMemory()
	try {
		const record = memory.createTask({
			kind: 'mining',
			blockName: 'iron_ore',
			total: 4
		})
		const marked = enterTaskRecord(
			contextWith({
				taskData: { ...createMiningTask('iron_ore', 4), taskId: record.id },
				bot: botWith(
					memoryWith(memory, {
						getTask: () => ({ ...memory.getTask(record.id)!, done: 99 })
					})
				)
			})
		)

		assert.equal(marked?.taskId, null)
		assert.match(marked?.lastFailure ?? '', /corrupt/)
	} finally {
		cleanup()
	}
})

test('enterTaskRecord validates resume payload before reactivation', async () => {
	const { memory, cleanup } = await createTaskMemory()
	try {
		const record = memory.createTask({
			kind: 'mining',
			blockName: 'iron_ore',
			total: 4
		})
		const setTaskStatus = memory.setTaskStatus.bind(memory)
		let activations = 0
		const marked = enterTaskRecord(
			contextWith({
				taskData: { ...createMiningTask('iron_ore', 4), taskId: record.id },
				bot: botWith(
					memoryWith(memory, {
						getTask: (id: string) => ({
							...memory.getTask(id)!,
							blockName: 'dirt'
						}),
						setTaskStatus: (
							...args: Parameters<MemoryManager['setTaskStatus']>
						) => {
							activations += 1
							return setTaskStatus(...args)
						}
					})
				)
			})
		)

		assert.equal(marked?.taskId, null)
		assert.match(marked?.lastFailure ?? '', /mismatch/)
		assert.equal(activations, 0)
		assert.equal(memory.getTask(record.id)?.status, 'suspended')
	} finally {
		cleanup()
	}
})

test('computeTaskStart rejects a flip that moves saved progress', async () => {
	const { memory, cleanup } = await createTaskMemory()
	try {
		const record = memory.createTask({
			kind: 'mining',
			blockName: 'iron_ore',
			total: 4
		})
		const outcome = computeTaskStart(
			contextWith({
				bot: botWith(
					memoryWith(memory, {
						getTask: (id: string) => memory.getTask(id),
						setTaskStatus: (id: string) => ({
							...memory.getTask(id)!,
							status: 'active',
							done: 3
						})
					})
				),
				pendingExecution: taskExecution('tasks_start', {
					task_id: record.id
				})
			})
		)

		assert.equal(outcome.lastResult, 'FAILED')
		assert.match(outcome.lastReason ?? '', /gone/)
		assert.equal(memory.getTask(record.id)?.status, 'suspended')
	} finally {
		cleanup()
	}
})

test('computeTaskCancel rejects corrupt saved progress', async () => {
	const { memory, cleanup } = await createTaskMemory()
	try {
		const record = memory.createTask({
			kind: 'mining',
			blockName: 'iron_ore',
			total: 4
		})
		const outcome = computeTaskCancel(
			contextWith({
				bot: botWith(
					memoryWith(memory, {
						getTask: () => ({ ...memory.getTask(record.id)!, done: -1 })
					})
				),
				pendingExecution: taskExecution('tasks_cancel', {
					task_id: record.id
				})
			})
		)

		assert.equal(outcome.lastResult, 'FAILED')
		assert.match(outcome.lastReason ?? '', /corrupt/)
		assert.equal(memory.getTask(record.id)?.status, 'suspended')
	} finally {
		cleanup()
	}
})

test('persistSuspendedTask syncs done but never clobbers a terminal row', async () => {
	const { memory, cleanup } = await createTaskMemory()
	try {
		const running = memory.createTask({
			kind: 'mining',
			blockName: 'iron_ore',
			total: 4
		})
		memory.setTaskStatus(running.id, 'active')
		const finished = memory.createTask({
			kind: 'mining',
			blockName: 'stone',
			total: 2
		})
		memory.setTaskStatus(finished.id, 'completed')

		taskRecordActions.persistSuspendedTask({
			context: contextWith({
				taskData: {
					...createMiningTask('iron_ore', 4),
					taskId: running.id,
					collected: 3
				},
				bot: botWith(memory)
			})
		})
		assert.equal(memory.getTask(running.id)?.status, 'suspended')
		assert.equal(memory.getTask(running.id)?.done, 3)

		taskRecordActions.persistSuspendedTask({
			context: contextWith({
				taskData: {
					...createMiningTask('stone', 2),
					taskId: finished.id,
					collected: 2
				},
				bot: botWith(memory)
			})
		})
		assert.equal(memory.getTask(finished.id)?.status, 'completed')
	} finally {
		cleanup()
	}
})

test('persistProgressTask moves done and keeps the running status', async () => {
	const { memory, cleanup } = await createTaskMemory()
	try {
		const record = memory.createTask({
			kind: 'mining',
			blockName: 'iron_ore',
			total: 4
		})
		memory.setTaskStatus(record.id, 'active')

		taskRecordActions.persistProgressTask({
			context: contextWith({
				taskData: {
					...createMiningTask('iron_ore', 4),
					taskId: record.id,
					collected: 1
				},
				bot: botWith(memory)
			})
		})

		assert.equal(memory.getTask(record.id)?.done, 1)
		assert.equal(memory.getTask(record.id)?.status, 'active')
	} finally {
		cleanup()
	}
})

test('persistProgressTask cannot revive a row that became terminal before the write', async () => {
	const { memory, cleanup } = await createTaskMemory()
	try {
		const record = memory.createTask({
			kind: 'mining',
			blockName: 'iron_ore',
			total: 4
		})
		memory.setTaskStatus(record.id, 'active')
		const updateTaskProgress = memory.updateTaskProgress.bind(memory)
		let raced = false
		memory.updateTaskProgress = (...args) => {
			if (!raced) {
				raced = true
				updateTaskProgress(record.id, 4, { status: 'completed' })
			}
			return updateTaskProgress(...args)
		}

		taskRecordActions.persistProgressTask({
			context: contextWith({
				taskData: {
					...createMiningTask('iron_ore', 4),
					taskId: record.id,
					collected: 1
				},
				bot: botWith(memory)
			})
		})

		assert.equal(memory.getTask(record.id)?.status, 'completed')
		assert.equal(memory.getTask(record.id)?.done, 4)
	} finally {
		cleanup()
	}
})

test('persistProgressTask rejects a corrupt pre-read before writing', async t => {
	const { memory, cleanup } = await createTaskMemory()
	try {
		const record = memory.createTask({
			kind: 'mining',
			blockName: 'iron_ore',
			total: 4
		})
		memory.setTaskStatus(record.id, 'active')
		const getTask = memory.getTask.bind(memory)
		const updateTaskProgress = memory.updateTaskProgress.bind(memory)
		memory.getTask = id => {
			const stored = getTask(id)
			return stored ? { ...stored, blockName: 'dirt', total: 9 } : null
		}
		let writes = 0
		memory.updateTaskProgress = (...args) => {
			writes += 1
			return updateTaskProgress(...args)
		}
		const errors: string[] = []
		t.mock.method(Logger, 'error', (message: string) => {
			errors.push(message)
		})

		taskRecordActions.persistProgressTask({
			context: contextWith({
				taskData: {
					...createMiningTask('iron_ore', 4),
					taskId: record.id,
					collected: 1
				},
				bot: botWith(memory)
			})
		})

		assert.equal(writes, 0)
		assert.ok(errors.some(message => message.includes('pre-read')))
	} finally {
		cleanup()
	}
})

test('computeTaskStart routes without spending the failure budget', async () => {
	const { memory, cleanup } = await createTaskMemory()
	try {
		const record = memory.createTask({
			kind: 'mining',
			blockName: 'iron_ore',
			total: 4
		})
		const budget = {
			...createGoalExecution(),
			attempts: 2,
			consecutiveFailures: 2,
			lastFailure: 'bad args'
		}
		const outcome = computeTaskStart(
			contextWith({
				bot: botWith(memory),
				pendingExecution: taskExecution('tasks_start', { task_id: record.id }),
				goalExecution: budget
			})
		)

		assert.equal(outcome.lastResult, 'SUCCESS')
		assert.deepEqual(outcome.goalExecution, budget)
	} finally {
		cleanup()
	}
})

test('computeTaskStart rejects a corrupt record payload', async () => {
	const { memory, cleanup } = await createTaskMemory()
	try {
		const record = memory.createTask({
			kind: 'mining',
			blockName: 'iron_ore',
			total: 4
		})
		const outcome = computeTaskStart(
			contextWith({
				bot: botWith(
					memoryWith(memory, {
						getTask: () => ({ ...memory.getTask(record.id)!, total: 0 })
					})
				),
				pendingExecution: taskExecution('tasks_start', {
					task_id: record.id
				})
			})
		)

		assert.equal(outcome.lastResult, 'FAILED')
		assert.match(outcome.lastReason ?? '', /corrupt/)
	} finally {
		cleanup()
	}
})

test('computeTaskStart rejects progress beyond the stored total', async () => {
	const { memory, cleanup } = await createTaskMemory()
	try {
		const record = memory.createTask({
			kind: 'mining',
			blockName: 'iron_ore',
			total: 4
		})
		memory.setTaskStatus(record.id, 'active')
		const outcome = computeTaskStart(
			contextWith({
				bot: botWith(
					memoryWith(memory, {
						getTask: () => ({ ...memory.getTask(record.id)!, done: 5 })
					})
				),
				pendingExecution: taskExecution('tasks_start', {
					task_id: record.id
				})
			})
		)

		assert.equal(outcome.lastResult, 'FAILED')
		assert.match(outcome.lastReason ?? '', /corrupt/)
		assert.equal(outcome.taskData, null)
	} finally {
		cleanup()
	}
})

test('computeTaskStart rejects a non-suspended record with a reason', async () => {
	const { memory, cleanup } = await createTaskMemory()
	try {
		const record = memory.createTask({
			kind: 'mining',
			blockName: 'iron_ore',
			total: 4
		})
		memory.setTaskStatus(record.id, 'completed')

		const outcome = computeTaskStart(
			contextWith({
				bot: botWith(memory),
				pendingExecution: taskExecution('tasks_start', { task_id: record.id })
			})
		)

		assert.equal(outcome.lastResult, 'FAILED')
		assert.match(outcome.lastReason ?? '', /only suspended tasks can start/)
		assert.equal(outcome.pendingExecution, null)
	} finally {
		cleanup()
	}
})
