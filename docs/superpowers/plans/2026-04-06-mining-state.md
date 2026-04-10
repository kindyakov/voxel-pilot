# MINING State Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a MINING state within EXECUTING for efficient resource mining with batch block search, minimizing LLM call overhead.

**Architecture:** New MINING substate inside EXECUTING with CHECKING_PRECONDITIONS → SEARCHING → NAVIGATING → BREAKING → CHECKING_GOAL cycle. Batch search finds N blocks at once. Y-filtering and safety analysis extracted to utilities.

**Tech Stack:** XState v5, Mineflayer, TypeScript, createStatefulService pattern

---

## Implementation Corrections From Codebase Review

The original draft had several unsafe assumptions. Treat this section as authoritative if any older snippet below conflicts with it.

- Do **not** use `FOUND` for batch search results. `src/hsm/types.ts` already has `FOUND` for older primitive payloads. Add a distinct `BLOCKS_FOUND` event with `blocks: Block[]` and wire MINING to `BLOCKS_FOUND`.
- Do **not** implement a pickaxe-only `hasRequiredTool` guard. `mine_resource` is also intended for logs and other resources, and `primitiveBreaking` already delegates harvest/tool selection to `bot.tool.equipForBlock(block, { requireHarvest: true })`. Preconditions should validate that the bot exists, the resource name is known, and there is inventory capacity; tool failures belong in BREAKING via `BREAKING_FAILED`.
- Follow the repo's current HSM import style: existing HSM alias imports usually omit `.js` extensions, e.g. `@/hsm/context`, `@/types`, `@/hsm/helpers/createStatefulService`.
- The search primitive file must be `src/hsm/actors/primitives/primitiveSearchBlock.primitive.ts`. Do not create `primitiveSearchBlock.ts`.
- Tests in this repo use Node's built-in `node:test` and `node:assert/strict`, not Vitest. Do not add `vitest` imports.
- `mine_resource` uses the existing tool-schema convention `block_name`, not `blockName`. The machine should normalize from `pendingExecution.args.block_name`.
- Adding the AI tool is not just an `AGENT_TOOLS` edit. Also update `AgentToolName`, `executionToolNames`, `summarizeExecution`, and `validateExecutionTool` so `mine_resource` is accepted without a grounded coordinate.
- MINING completion must record success/failure before returning to `DECIDE_NEXT`. Do not use a parent `onDone` that loses whether the final state was success or failure.

## Problem Statement

**Current behavior:** Every action (find → navigate → break) triggers an LLM call:

- Network latency
- Model reasoning time
- State transitions
- Tool invocations

**Result:** High latency for simple tasks like "Mine 10 iron ore blocks".

**Solution:** Single MINING state that handles batch block search and cyclic mining without repeated LLM calls.

---

## Architecture Overview

### State Machine Integration

```
MAIN_ACTIVITY.TASKS
├── IDLE
├── THINKING (AI loop)
└── EXECUTING
    ├── RESOLVE (determines execution type)
    │   - toolName === 'mine_resource' → MINING
    │   - toolName === 'navigate_to' → NAVIGATING
    │   - toolName === 'break_block' → BREAKING
    │   - ...
    ├── MINING ← new state
    │   ├── CHECKING_PRECONDITIONS
    │   ├── SEARCHING (batch: finds N blocks)
    │   ├── NAVIGATING (to first block)
    │   ├── BREAKING (mines current block)
    │   ├── CHECKING_GOAL
    │   │   - collected >= count → TASK_COMPLETED
    │   │   - otherwise → NAVIGATING (next block)
    │   └── TASK_COMPLETED / TASK_FAILED
    ├── NAVIGATING
    ├── BREAKING
    └── DECIDE_NEXT
```

### Component Map

| File                                                          | Action | Responsibility                                                |
| ------------------------------------------------------------- | ------ | ------------------------------------------------------------- |
| `src/hsm/utils/blockAnalysis.ts`                              | Create | Block filtering, scoring, sorting utilities                   |
| `src/hsm/actors/primitives/primitiveSearchBlock.primitive.ts` | Create | Block search primitive (simple/mining modes)                  |
| `src/hsm/guards/mining.guards.ts`                             | Create | Guards for MINING state transitions                           |
| `src/hsm/actions/mining.actions.ts`                           | Create | Actions for MINING state                                      |
| `src/hsm/machine.ts`                                          | Modify | Add MINING state to EXECUTING, register actors/guards/actions |
| `src/hsm/types.ts`                                            | Modify | Add MiningTaskData type, MINING events                        |
| `src/tests/hsm/blockAnalysis.test.ts`                         | Create | Unit tests for block analysis utilities                       |
| `src/tests/hsm/primitiveSearchBlock.primitive.test.ts`        | Create | Tests for search primitive                                    |

---

## Design Decisions

### 1. Y-Filter (Asymmetric)

Based on voxel-pilot reference and safety considerations:

```typescript
interface YRangeFilter {
	above: number // blocks higher than bot (default: 6)
	below: number // blocks lower than bot (default: 2)
}
```

**Rationale:**

- Asymmetric filter prevents digging deep under the bot (risky)
- Prefers blocks at bot level or above
- For mining: typically `+6/-2` range

### 2. Search Modes

**Simple mode** (for chests, crafting tables, furnaces):

- Input: `{ blockName: 'chest', maxDistance: 32 }`
- Returns: nearest block, no Y-filter, no safety checks
- Event: `{ type: 'BLOCKS_FOUND', blocks: [Block] }`

**Mining mode** (for ores, resources):

- Input: `{ blockName: 'iron_ore', count: 10, maxYDiffAbove: 6, maxYDiffBelow: 2, prioritizeSafety: true }`
- Returns: N best blocks with Y-filter, safety checks, priority scoring
- Event: `{ type: 'BLOCKS_FOUND', blocks: Block[] }`

### 3. Batch Search

SEARCHING state finds all N blocks in one call:

- Reduces LLM overhead
- Enables efficient planning (closest blocks first)
- Handles partial results gracefully (if only 5/10 found, mine those)

### 4. LLM Trigger

LLM returns special execution type:

```json
{
	"kind": "execute",
	"execution": {
		"toolName": "mine_resource",
		"args": {
			"blockName": "iron_ore",
			"count": 10
		}
	}
}
```

Guard `isMiningExecution` routes to MINING state.

### 5. Inventory Full Handling

When inventory fills during mining:

- Pause mining
- Query LLM for decision (continue with drops, stop, etc.)
- This is an edge case, not primary flow

---

## Task 1: Block Analysis Utilities

**Files:**

- Create: `src/hsm/utils/blockAnalysis.ts`
- Test: `src/tests/hsm/blockAnalysis.test.ts`

- [ ] **Step 1: Write tests using node:test (not vitest)**

```typescript
import assert from 'node:assert/strict'
import test from 'node:test'

import {
	type AnalyzedBlock,
	calculateBlockScore,
	filterByYRange,
	selectBestBlocks,
	sortBlocksByPriority
} from '../../hsm/utils/blockAnalysis.js'

const createBlock = (y: number, yDiff: number, distance = 5): AnalyzedBlock => ({
	block: {} as any,
	position: { x: 0, y, z: 0 } as any,
	distanceHorizontal: distance,
	distanceTotal: distance,
	yDiff
})

test('filterByYRange keeps blocks within an asymmetric Y range', () => {
	const blocks: AnalyzedBlock[] = [
		createBlock(64, 0),
		createBlock(68, 4),
		createBlock(70, 6),
		createBlock(62, -2),
		createBlock(60, -4)
	]

	const result = filterByYRange(blocks, 64, { above: 4, below: 2 })

	assert.equal(result.length, 3)
	assert.deepEqual(
		result.map(block => block.yDiff),
		[0, 4, -2]
	)
})

test('filterByYRange returns all blocks when no Y filter is specified', () => {
	const blocks = [createBlock(64, 0), createBlock(70, 6), createBlock(60, -4)]

	const result = filterByYRange(blocks, 64)

	assert.equal(result.length, 3)
})

test('calculateBlockScore prefers level, above, and nearer blocks', () => {
	assert.ok(calculateBlockScore(createBlock(64, 0)) > calculateBlockScore(createBlock(68, 4)))
	assert.ok(calculateBlockScore(createBlock(68, 4)) > calculateBlockScore(createBlock(60, -4)))
	assert.ok(calculateBlockScore(createBlock(64, 0, 2)) > calculateBlockScore(createBlock(64, 0, 20)))
})

test('sortBlocksByPriority sorts by descending score', () => {
	const sorted = sortBlocksByPriority([
		createBlock(68, 4, 20),
		createBlock(64, 0, 2),
		createBlock(66, 2, 10)
	])

	assert.equal(sorted[0].distanceTotal, 2)
	assert.equal(sorted[0].yDiff, 0)
})

test('selectBestBlocks returns the top N prioritized blocks', () => {
	const result = selectBestBlocks(
		[createBlock(64, 0, 1), createBlock(64, 0, 2), createBlock(64, 0, 3)],
		2
	)

	assert.equal(result.length, 2)
	assert.equal(result[0].distanceTotal, 1)
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --import tsx --test src/tests/hsm/blockAnalysis.test.ts`
Expected: FAIL - module not found

- [ ] **Step 3: Implement block analysis utilities**

```typescript
// src/hsm/utils/blockAnalysis.ts
import type { Block, Bot, Vec3 } from '@/types'

export interface AnalyzedBlock {
	block: Block
	position: Vec3
	distanceHorizontal: number
	distanceTotal: number
	yDiff: number
}

export interface YRangeFilter {
	above: number
	below: number
}

export interface ScoringOptions {
	yWeight?: number
	distanceWeight?: number
}

/**
 * Filters blocks by asymmetric Y-range.
 * @param blocks - analyzed blocks
 * @param botY - current Y position of bot
 * @param yRange - optional filter {above, below}
 */
export function filterByYRange(
	blocks: AnalyzedBlock[],
	botY: number,
	yRange?: YRangeFilter
): AnalyzedBlock[] {
	if (!yRange) {
		return blocks
	}

	return blocks.filter(b => {
		const diff = b.position.y - botY
		if (diff > 0) {
			return diff <= yRange.above
		}
		return Math.abs(diff) <= yRange.below
	})
}

/**
 * Checks if block is directly below bot's feet.
 */
export function isBlockDirectlyBelowBot(bot: Bot, pos: Vec3): boolean {
	const botPos = bot.entity.position
	return (
		Math.abs(pos.x - botPos.x) < 0.5 &&
		Math.abs(pos.z - botPos.z) < 0.5 &&
		pos.y < botPos.y
	)
}

/**
 * Checks block safety for mining.
 * Block is unsafe if there's no support below or it's under bot's feet.
 */
export function checkBlockSafety(
	bot: Bot,
	pos: Vec3
): { isSafe: boolean; reason?: string } {
	if (isBlockDirectlyBelowBot(bot, pos)) {
		return { isSafe: false, reason: 'block_directly_below_bot' }
	}

	const belowPos = { x: pos.x, y: pos.y - 1, z: pos.z } as Vec3
	const blockBelow = bot.blockAt(belowPos)

	if (
		!blockBelow ||
		blockBelow.name === 'air' ||
		blockBelow.name === 'cave_air'
	) {
		return { isSafe: false, reason: 'no_support_below' }
	}

	return { isSafe: true }
}

/**
 * Filters out unsafe blocks.
 */
export function filterSafeBlocks(
	blocks: AnalyzedBlock[],
	bot: Bot
): AnalyzedBlock[] {
	return blocks.filter(b => {
		const safety = checkBlockSafety(bot, b.position)
		if (!safety.isSafe) {
			console.log(
				`⚠️ [blockAnalysis] Skipping unsafe block at ${b.position} - ${safety.reason}`
			)
			return false
		}
		return true
	})
}

/**
 * Calculates block score for prioritization.
 * Formula: (10 - |yDiff|/2) * 2 + (20 - distance/10)
 * Y-bonus: blocks at level or above preferred
 * Distance-penalty: closer = better
 */
export function calculateBlockScore(
	b: AnalyzedBlock,
	options?: ScoringOptions
): number {
	const yWeight = options?.yWeight ?? 2
	const distanceWeight = options?.distanceWeight ?? 1

	let yScore: number
	if (b.yDiff >= 0) {
		// Block at level or above - small penalty for height
		yScore = 10 - b.yDiff * 0.5
	} else {
		// Block below - larger penalty (risky to dig under)
		yScore = 10 - Math.abs(b.yDiff) * 1.5
	}

	const distanceScore = 20 - b.distanceTotal / 10

	return yScore * yWeight + distanceScore * distanceWeight
}

/**
 * Sorts blocks by priority (score descending).
 */
export function sortBlocksByPriority(blocks: AnalyzedBlock[]): AnalyzedBlock[] {
	return [...blocks].sort((a, b) => {
		const aScore = calculateBlockScore(a)
		const bScore = calculateBlockScore(b)
		return bScore - aScore
	})
}

/**
 * Selects N best blocks by priority.
 */
export function selectBestBlocks(
	blocks: AnalyzedBlock[],
	count: number
): AnalyzedBlock[] {
	const sorted = sortBlocksByPriority(blocks)
	return sorted.slice(0, count)
}

/**
 * Analyzes block position and returns AnalyzedBlock.
 */
export function analyzeBlock(pos: Vec3, bot: Bot): AnalyzedBlock | null {
	const block = bot.blockAt(pos)
	if (!block) return null

	const botPos = bot.entity.position
	const distanceHorizontal = Math.sqrt(
		Math.pow(pos.x - botPos.x, 2) + Math.pow(pos.z - botPos.z, 2)
	)
	const distanceTotal = botPos.distanceTo(pos)
	const yDiff = pos.y - botPos.y

	return {
		block,
		position: pos,
		distanceHorizontal,
		distanceTotal,
		yDiff
	}
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --import tsx --test src/tests/hsm/blockAnalysis.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/hsm/utils/blockAnalysis.ts src/tests/hsm/blockAnalysis.test.ts
git commit -m "feat: add block analysis utilities with Y-filtering and scoring"
```

---

## Task 2: primitiveSearchBlock

**Files:**

- Create: `src/hsm/actors/primitives/primitiveSearchBlock.primitive.ts`
- Test: `src/tests/hsm/primitiveSearchBlock.primitive.test.ts`

- [ ] **Step 1: Write failing primitiveSearchBlock tests**

Create `src/tests/hsm/primitiveSearchBlock.primitive.test.ts` with Node `node:test` coverage for these behaviours:

- Unknown `blockName` emits `NOT_FOUND`.
- Simple mode emits `BLOCKS_FOUND` with the nearest matching block.
- Mining mode applies Y filtering and returns at most `count` prioritized blocks.

Use a small parent test machine that invokes `primitiveSearchBlock`; do not instantiate the callback actor without a parent, because `sendBack` events must be observed by the invoking machine.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --import tsx --test src/tests/hsm/primitiveSearchBlock.primitive.test.ts`
Expected: FAIL because `src/hsm/actors/primitives/primitiveSearchBlock.primitive.ts` does not exist yet.

- [ ] **Step 3: Implement primitiveSearchBlock**

```typescript
// src/hsm/actors/primitives/primitiveSearchBlock.primitive.ts
import type { Block } from '@/types'

import {
	type BaseServiceState,
	createStatefulService
} from '@/hsm/helpers/createStatefulService'
import {
	type AnalyzedBlock,
	type YRangeFilter,
	analyzeBlock,
	filterByYRange,
	filterSafeBlocks,
	selectBestBlocks
} from '@/hsm/utils/blockAnalysis'

interface SearchBlockState extends BaseServiceState {
	blockName: string
	maxDistance: number
	count: number
	mode: 'simple' | 'mining'
	blockId: number | null
	searching: boolean
	yRange?: YRangeFilter
	prioritizeSafety: boolean
}

interface SearchBlockOptions {
	blockName: string
	maxDistance?: number
	count?: number
	mode?: 'simple' | 'mining'
	maxYDiffAbove?: number
	maxYDiffBelow?: number
	prioritizeSafety?: boolean
}

const DEFAULTS = {
	maxDistance: 32,
	count: 1,
	mode: 'simple' as const,
	prioritizeSafety: false
}

export const primitiveSearchBlock = createStatefulService<
	SearchBlockState,
	SearchBlockOptions
>({
	name: 'primitiveSearchBlock',
	tickInterval: 1000,
	initialState: {
		blockName: '',
		maxDistance: DEFAULTS.maxDistance,
		count: DEFAULTS.count,
		mode: DEFAULTS.mode,
		blockId: null,
		searching: false,
		prioritizeSafety: DEFAULTS.prioritizeSafety
	},

	onStart: api => {
		const {
			blockName,
			maxDistance = DEFAULTS.maxDistance,
			count = DEFAULTS.count,
			mode = DEFAULTS.mode,
			prioritizeSafety = DEFAULTS.prioritizeSafety
		} = api.input

		if (!blockName) {
			console.error('[primitiveSearchBlock] ❌ Missing blockName')
			api.sendBack({
				type: 'NOT_FOUND',
				reason: 'Missing required parameter: blockName'
			})
			return
		}

		const blockData = api.bot.registry.blocksByName[blockName]
		if (!blockData) {
			console.error(`[primitiveSearchBlock] ❌ Unknown block: ${blockName}`)
			api.sendBack({
				type: 'NOT_FOUND',
				reason: `Unknown block type: ${blockName}`
			})
			return
		}

		const yRange =
			mode === 'mining' && (api.input.maxYDiffAbove || api.input.maxYDiffBelow)
				? {
						above: api.input.maxYDiffAbove ?? 6,
						below: api.input.maxYDiffBelow ?? 2
					}
				: undefined

		api.setState({
			blockName,
			maxDistance,
			count,
			mode,
			blockId: blockData.id,
			searching: true,
			yRange,
			prioritizeSafety
		})

		console.log(
			`🔍 [primitiveSearchBlock] Searching for ${blockName} (ID: ${blockData.id}, mode: ${mode}, maxDist: ${maxDistance}m, count: ${count})`
		)
	},

	onTick: api => {
		const {
			blockName,
			maxDistance,
			count,
			mode,
			searching,
			blockId,
			yRange,
			prioritizeSafety
		} = api.state

		if (!searching || !blockId) return

		const botPos = api.bot.entity.position

		// Find all candidate blocks
		const blockPositions = api.bot.findBlocks({
			matching: blockId,
			maxDistance,
			count: Math.max(count * 10, 100)
		})

		if (blockPositions.length === 0) {
			console.log(
				`⚠️ [primitiveSearchBlock] No ${blockName} found within ${maxDistance}m`
			)
			api.setState({ searching: false })
			api.sendBack({
				type: 'NOT_FOUND',
				reason: `No ${blockName} found within ${maxDistance}m`
			})
			return
		}

		// Analyze all positions
		const analyzedBlocks: AnalyzedBlock[] = blockPositions
			.map(pos => analyzeBlock(pos, api.bot))
			.filter((b): b is AnalyzedBlock => b !== null)

		if (analyzedBlocks.length === 0) {
			api.setState({ searching: false })
			api.sendBack({
				type: 'NOT_FOUND',
				reason: `Could not analyze any ${blockName} blocks`
			})
			return
		}

		let resultBlocks: Block[]

		if (mode === 'simple') {
			// Simple mode: return nearest block
			const sorted = analyzedBlocks.sort(
				(a, b) => a.distanceTotal - b.distanceTotal
			)
			resultBlocks = [sorted[0].block]
			console.log(
				`✅ [primitiveSearchBlock] Found ${blockName} at ${sorted[0].position} (${sorted[0].distanceTotal.toFixed(1)}m)`
			)
		} else {
			// Mining mode: filter, score, select top N
			let filtered = analyzedBlocks

			// Apply Y-range filter
			if (yRange) {
				filtered = filterByYRange(filtered, botPos.y, yRange)
				console.log(
					`📊 [primitiveSearchBlock] After Y-filter: ${filtered.length} blocks (range: +${yRange.above}/-${yRange.below})`
				)
			}

			// Apply safety filter
			if (prioritizeSafety) {
				filtered = filterSafeBlocks(filtered, api.bot)
				console.log(
					`🛡️ [primitiveSearchBlock] After safety filter: ${filtered.length} blocks`
				)
			}

			if (filtered.length === 0) {
				api.setState({ searching: false })
				api.sendBack({
					type: 'NOT_FOUND',
					reason: `No safe ${blockName} blocks found after filtering`
				})
				return
			}

			// Select best blocks
			const selected = selectBestBlocks(filtered, count)
			resultBlocks = selected.map(b => b.block)

			console.log(
				`✅ [primitiveSearchBlock] Found ${resultBlocks.length}/${count} ${blockName} blocks`
			)
		}

		api.setState({ searching: false })
		api.sendBack({
			type: 'BLOCKS_FOUND',
			blocks: resultBlocks
		})
	},

	onCleanup: () => {
		console.log('[primitiveSearchBlock] Cleanup')
	}
})
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --import tsx --test src/tests/hsm/primitiveSearchBlock.primitive.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/hsm/actors/primitives/primitiveSearchBlock.primitive.ts src/tests/hsm/primitiveSearchBlock.primitive.test.ts
git commit -m "feat: add primitiveSearchBlock with simple and mining modes"
```

---

## Task 3: Mining Guards and Actions

**Files:**

- Create: `src/hsm/guards/mining.guards.ts`
- Create: `src/hsm/actions/mining.actions.ts`

- [ ] **Step 1: Implement mining guards**

```typescript
// src/hsm/guards/mining.guards.ts
import type { MachineContext } from '@/hsm/context'
import type { MiningTaskData } from '@/hsm/types'

const getMiningTaskData = (context: MachineContext): MiningTaskData | null =>
	(context.taskData as MiningTaskData | null) ?? null

const countPlayerInventoryEmptySlots = (context: MachineContext): number => {
	const slots = context.bot?.inventory.slots ?? []
	return slots
		.slice(9, 45)
		.filter(slot => slot === null).length
}

export const miningGuards = {
	canAttemptMining: ({ context }: { context: MachineContext }) => {
		const taskData = getMiningTaskData(context)
		if (!taskData || !context.bot) return false

		const blockData = context.bot.registry.blocksByName[taskData.blockName]
		if (!blockData) return false

		return taskData.count > 0 && countPlayerInventoryEmptySlots(context) > 2
	},

	isBlockNearby: ({ context }: { context: MachineContext }) => {
		const taskData = getMiningTaskData(context)
		if (!taskData || !context.bot?.entity) return false

		const targetBlock = taskData.targetBlocks?.[taskData.targetIndex]
		if (!targetBlock?.position) return false

		const distance = context.bot.entity.position.distanceTo(
			targetBlock.position
		)
		return distance <= 4
	},

	isMiningGoalComplete: ({ context }: { context: MachineContext }) => {
		const taskData = getMiningTaskData(context)
		if (!taskData) return false

		return taskData.collected >= taskData.count
	},

	hasMoreBlocksToMine: ({ context }: { context: MachineContext }) => {
		const taskData = getMiningTaskData(context)
		if (!taskData) return false

		return taskData.targetIndex < (taskData.targetBlocks?.length ?? 0)
	},

	isInventoryFull: ({ context }: { context: MachineContext }) => {
		return countPlayerInventoryEmptySlots(context) <= 2
	},

	maxNavigationAttemptsReached: ({ context }: { context: MachineContext }) => {
		const taskData = getMiningTaskData(context)
		if (!taskData) return false

		return (taskData.navigationAttempts ?? 0) >= 3
	}
}
```

- [ ] **Step 2: Implement mining actions**

```typescript
// src/hsm/actions/mining.actions.ts
import { assign } from 'xstate'

import type { MachineContext } from '@/hsm/context'
import type { MachineEvent, MiningTaskData } from '@/hsm/types'

export const miningActions = {
	entryMining: ({ context }: { context: MachineContext }) => {
		const data = context.taskData as MiningTaskData
		console.log(
			`[MINING] Starting mining task: ${data.blockName} x${data.count}`
		)
	},

	exitMining: ({ context }: { context: MachineContext }) => {
		console.log('[MINING] Exiting mining state')
	},

	storeFoundBlocks: assign({
		taskData: ({
			context,
			event
		}: {
			context: MachineContext
			event: Extract<MachineEvent, { type: 'BLOCKS_FOUND' }>
		}) => {
			const currentData = context.taskData as MiningTaskData | null
			return {
				...currentData,
				blockName: currentData?.blockName ?? '',
				count: currentData?.count ?? 1,
				targetBlocks: event.blocks,
				targetIndex: 0,
				collected: currentData?.collected ?? 0,
				navigationAttempts: 0
			} as MiningTaskData
		}
	}),

	advanceToNextBlock: assign({
		taskData: ({ context }: { context: MachineContext }) => {
			const data = context.taskData as MiningTaskData
			return {
				...data,
				targetIndex: data.targetIndex + 1
			} as MiningTaskData
		}
	}),

	incrementCollected: assign({
		taskData: ({ context }: { context: MachineContext }) => {
			const data = context.taskData as MiningTaskData
			return {
				...data,
				collected: (data.collected ?? 0) + 1
			} as MiningTaskData
		}
	}),

	incrementNavigationAttempts: assign({
		taskData: ({ context }: { context: MachineContext }) => {
			const data = context.taskData as MiningTaskData
			return {
				...data,
				navigationAttempts: (data.navigationAttempts ?? 0) + 1
			} as MiningTaskData
		}
	}),

	resetNavigationAttempts: assign({
		taskData: ({ context }: { context: MachineContext }) => {
			const data = context.taskData as MiningTaskData
			return {
				...data,
				navigationAttempts: 0
			} as MiningTaskData
		}
	}),

	taskMiningCompleted: ({ context }: { context: MachineContext }) => {
		const data = context.taskData as MiningTaskData
		console.log(
			`[MINING] Task completed: collected ${data.collected}/${data.count} ${data.blockName}`
		)
		context.bot?.chat(`Добыто ${data.collected} ${data.blockName}`)
	},

	taskMiningFailed: ({ context }: { context: MachineContext }) => {
		const data = context.taskData as MiningTaskData
		console.log(
			`[MINING] Task failed: collected ${data.collected ?? 0}/${data.count} ${data.blockName}`
		)
		context.bot?.chat(
			`Не удалось завершить добычу ${data.blockName}. Собрано: ${data.collected ?? 0}/${data.count}`
		)
	}
}
```

- [ ] **Step 3: Commit**

```bash
git add src/hsm/guards/mining.guards.ts src/hsm/actions/mining.actions.ts
git commit -m "feat: add mining guards and actions"
```

---

## Task 4: Update Types

**Files:**

- Modify: `src/hsm/types.ts`

- [ ] **Step 1: Add MiningTaskData and BLOCKS_FOUND event**

Read `src/hsm/types.ts` and add:

```typescript
// Add to PrimitiveEvents union
| { type: 'BLOCKS_FOUND'; blocks: Block[] }
| { type: 'INVENTORY_FULL' }

// Add MiningTaskData interface at end of file
export interface MiningTaskData {
  blockName: string
  count: number
  targetBlocks: Block[]
  targetIndex: number
  collected: number
  navigationAttempts: number
}
```

- [ ] **Step 2: Commit**

```bash
git add src/hsm/types.ts
git commit -m "feat: add MiningTaskData type and block search event"
```

---

## Task 5: Integrate MINING State into Machine

**Files:**

- Modify: `src/hsm/machine.ts`

- [ ] **Step 1: Import new modules**

Add at top of imports section in `src/hsm/machine.ts`:

```typescript
import { miningActions } from '@/hsm/actions/mining.actions'
import { primitiveSearchBlock } from '@/hsm/actors/primitives/primitiveSearchBlock.primitive'
import { miningGuards } from '@/hsm/guards/mining.guards'
```

- [ ] **Step 2: Register in guards and actions**

In the `setup()` call, add to guards object:

```typescript
...miningGuards,
isMiningExecution: ({ context }) =>
  context.pendingExecution?.toolName === 'mine_resource',
```

Add to actions object:

```typescript
...miningActions,
```

- [ ] **Step 3: Add MINING state to EXECUTING.states**

Add MINING as a sibling to NAVIGATING, BREAKING, etc. in EXECUTING.states:

```typescript
MINING: {
  initial: 'CHECKING_PRECONDITIONS',
  entry: ['entryMining'],
  exit: ['exitMining'],
  states: {
    CHECKING_PRECONDITIONS: {
      always: [
        {
          guard: 'canAttemptMining',
          target: 'SEARCHING'
        },
        {
          target: 'TASK_FAILED'
        }
      ]
    },
    SEARCHING: {
      invoke: {
        src: primitiveSearchBlock,
        input: ({ context }: { context: MachineContext }) => ({
          bot: context.bot!,
          options: {
            blockName: (context.taskData as MiningTaskData).blockName,
            count: (context.taskData as MiningTaskData).count,
            maxDistance: 64,
            mode: 'mining',
            maxYDiffAbove: 6,
            maxYDiffBelow: 2,
            prioritizeSafety: true
          }
        })
      },
      on: {
        BLOCKS_FOUND: {
          target: 'CHECKING_DISTANCE',
          actions: ['storeFoundBlocks']
        },
        NOT_FOUND: 'TASK_FAILED',
        ERROR: 'TASK_FAILED'
      }
    },
    CHECKING_DISTANCE: {
      always: [
        {
          guard: 'isBlockNearby',
          target: 'BREAKING'
        },
        {
          target: 'NAVIGATING'
        }
      ]
    },
    NAVIGATING: {
      invoke: {
        src: primitiveNavigating,
        input: ({ context }: { context: MachineContext }) => {
          const taskData = context.taskData as MiningTaskData
          const targetBlock = taskData.targetBlocks?.[taskData.targetIndex]
          return {
            bot: context.bot!,
            options: {
              target: targetBlock?.position
            }
          }
        }
      },
      on: {
        ARRIVED: {
          target: 'BREAKING'
        },
        NAVIGATION_FAILED: [
          {
            guard: 'maxNavigationAttemptsReached',
            target: 'TASK_FAILED'
          },
          {
            target: 'SEARCHING',
            actions: ['incrementNavigationAttempts']
          }
        ],
        ERROR: 'TASK_FAILED'
      }
    },
    BREAKING: {
      invoke: {
        src: primitiveBreaking,
        input: ({ context }: { context: MachineContext }) => {
          const taskData = context.taskData as MiningTaskData
          const targetBlock = taskData.targetBlocks?.[taskData.targetIndex]
          return {
            bot: context.bot!,
            options: {
              block: targetBlock
            }
          }
        }
      },
      on: {
        BROKEN: {
          target: 'CHECKING_GOAL',
          actions: ['incrementCollected', 'resetNavigationAttempts']
        },
        BREAKING_FAILED: 'SEARCHING',
        ERROR: 'TASK_FAILED'
      }
    },
    CHECKING_GOAL: {
      always: [
        {
          guard: 'isMiningGoalComplete',
          target: 'TASK_COMPLETED'
        },
        {
          guard: 'isInventoryFull',
          target: 'TASK_FAILED'
        },
        {
          guard: 'hasMoreBlocksToMine',
          target: 'NAVIGATING',
          actions: ['advanceToNextBlock']
        },
        {
          target: 'SEARCHING'
        }
      ]
    },
    TASK_COMPLETED: {
      entry: [
        'taskMiningCompleted',
        'recordExecutionSuccess',
        assign({ taskData: () => null })
      ],
      always: '#MINECRAFT_BOT.MAIN_ACTIVITY.TASKS.DECIDE_NEXT'
    },
    TASK_FAILED: {
      entry: [
        'taskMiningFailed',
        'recordExecutionFailure',
        assign({ taskData: () => null })
      ],
      always: '#MINECRAFT_BOT.MAIN_ACTIVITY.TASKS.DECIDE_NEXT'
    }
  }
}
```

- [ ] **Step 4: Add MINING to RESOLVE transitions**

In EXECUTING.states.RESOLVE.always array, add (before fallback):

```typescript
{
  guard: 'isMiningExecution',
  target: 'MINING',
  actions: [
    assign({
      taskData: ({ context }) => ({
        blockName: String(context.pendingExecution?.args.block_name ?? ''),
        count:
          typeof context.pendingExecution?.args.count === 'number'
            ? context.pendingExecution.args.count
            : 1,
        targetBlocks: [],
        targetIndex: 0,
        collected: 0,
        navigationAttempts: 0
      } as MiningTaskData)
    })
  ]
}
```

- [ ] **Step 5: Commit**

```bash
git add src/hsm/machine.ts
git commit -m "feat: integrate MINING state into EXECUTING with full lifecycle"
```

---

## Task 6: Add mine_resource Tool to AI

**Files:**

- Modify: `src/ai/tools.ts`
- Modify: `src/ai/loop.ts`

- [ ] **Step 1: Add mine_resource tool schema**

Add to `AGENT_TOOLS` array in `src/ai/tools.ts`:

```typescript
tool(
	'mine_resource',
	'Mine a specific quantity of a block type efficiently. Use for resource gathering tasks like mining ore, wood, or other materials. Executes batch search and cyclic mining without repeated LLM calls.',
	{
		block_name: {
			type: 'string',
			description:
				'Block type to mine (e.g., iron_ore, coal_ore, diamond_ore, oak_log)'
		},
		count: {
			type: 'number',
			description: 'Number of blocks to mine'
		}
	}
)
```

- [ ] **Step 2: Handle in resolveExecutionActor**

- [ ] **Step 2: Register mine_resource as an execution tool**

In `src/ai/tools.ts`:

- Add `'mine_resource'` to `AgentToolName`.
- Add `'mine_resource'` to `executionToolNames`.
- Add a `summarizeExecution` case:

```typescript
case 'mine_resource':
	return `Mine ${String(execution.args.count ?? 1)} ${String(execution.args.block_name ?? 'blocks')}`
```

- Update `AGENT_SYSTEM_PROMPT` to prefer `mine_resource` for repeated resource gathering after inventory inspection. Do not require `inspect_blocks` before `mine_resource`; the MINING primitive performs its own world search.

- [ ] **Step 3: Let the AI loop validate mine_resource correctly**

In `src/ai/loop.ts`, update `validateExecutionTool`:

```typescript
case 'mine_resource': {
	const blockName = normalizeFactValue(execution.args.block_name)
	const count = execution.args.count
	if (!blockName) {
		return 'Execution tool "mine_resource" requires block_name'
	}
	if (typeof count !== 'number' || !Number.isFinite(count) || count <= 0) {
		return 'Execution tool "mine_resource" requires a positive count'
	}
	return null
}
```

Do not add a grounded-position requirement for `mine_resource`. That would defeat the purpose of the batch-search state.

- [ ] **Step 4: Commit**

```bash
git add src/ai/tools.ts src/ai/loop.ts
git commit -m "feat: add mine_resource tool to AI agent"
```

---

## Task 7: Integration Testing

**Files:**

- Modify: `src/tests/hsm/machine.test.ts`

- [ ] **Step 1: Add a real MINING routing integration test**

```typescript
test('mine_resource execution routes into MINING search state', async () => {
	const thinkingActor = fromPromise(async () => ({
		kind: 'execute' as const,
		execution: {
			toolName: 'mine_resource' as const,
			args: {
				block_name: 'iron_ore',
				count: 2
			}
		},
		subGoal: 'Mine iron ore',
		transcript: ['mine_resource']
	}))

	const bot = new FakeBot() as any
	bot.registry = {
		...bot.registry,
		blocksByName: {
			iron_ore: { id: 15, name: 'iron_ore' }
		}
	}

	const actor = createActor(
		createBotMachine({
			thinkingActor,
			actors: {
				serviceEntitiesTracking: noopActor,
				serviceApproaching: noopActor,
				serviceMeleeAttack: noopActor,
				serviceRangedSkirmish: noopActor,
				serviceFleeing: noopActor,
				serviceEmergencyEating: hangingActor,
				serviceEmergencyHealing: hangingActor
			}
		}),
		{
			input: { bot }
		}
	)

	bot.hsm = {
		getContext: () => actor.getSnapshot().context
	}

	actor.start()

	try {
		actor.send({
			type: 'USER_COMMAND',
			username: 'Steve',
			text: 'Mine 2 iron ore'
		})
		await waitForTurn()
		await waitForTurn()

		assert.equal(
			(actor.getSnapshot() as any).matches({
				MAIN_ACTIVITY: {
					TASKS: { EXECUTING: { MINING: 'SEARCHING' } }
				}
			}),
			true
		)
		assert.equal((actor.getSnapshot().context.taskData as any).blockName, 'iron_ore')
		assert.equal((actor.getSnapshot().context.taskData as any).count, 2)
	} finally {
		actor.stop()
	}
})
```

- [ ] **Step 2: Run full test suite**

Run: `node --import tsx --test src/tests/hsm/machine.test.ts`
Expected: All tests pass

- [ ] **Step 3: Run type check and build**

Run separately so failures are attributable:

```bash
npm run type-check
npm run build
```

Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/tests/hsm/machine.test.ts
git commit -m "test: cover mine_resource HSM routing"
```

---

## Verification Checklist

- [ ] All tests pass: `node --import tsx --test src/tests/hsm/*.test.ts`
- [ ] Type check passes: `npm run type-check`
- [ ] Build succeeds: `npm run build`
- [ ] No unused exports: `npm run knip`
- [ ] MINING state accessible from EXECUTING.RESOLVE
- [ ] Batch search returns multiple blocks
- [ ] Y-filtering works correctly (asymmetric: +6/-2)
- [ ] Safety filtering prevents dangerous mining (under feet)
- [ ] Goal completion triggers when collected >= count
- [ ] Navigation retry logic works (3 attempts max)
- [ ] Inventory full detection works

---

## Edge Cases Handled

| Situation             | Behavior                                  |
| --------------------- | ----------------------------------------- |
| No tool available     | `CHECKING_PRECONDITIONS` → `TASK_FAILED`  |
| Blocks not found      | `SEARCHING` → `NOT_FOUND` → `TASK_FAILED` |
| Navigation fails > 3x | `NAVIGATING` → `TASK_FAILED`              |
| Inventory full        | `CHECKING_GOAL` → `TASK_FAILED`           |
| Block destroyed       | `collected++`, continue to next           |
| Batch < count         | Continue with available blocks            |
| Partial success       | Report collected/total on completion      |

---

## Future Enhancements

1. **Smart tool selection** - Auto-craft pickaxe if missing
2. **Chunk caching** - Remember where blocks were found
3. **Multi-type mining** - Mine multiple ore types in one pass
4. **Strip mining mode** - Systematic exploration patterns
5. **Return to base** - Deposit items when inventory full, resume mining

---

## References

- **voxel-pilot MINING implementation:** https://github.com/kindyakov/voxel-pilot/blob/86df4bcf38df2bddf881f5170765a1d2500cbb08/src/hsm/machine.ts
- **XState v5 docs:** https://stately.ai/docs/xstate
- **Mineflayer findBlocks:** https://github.com/PrismarineJS/mineflayer/blob/master/docs/api.md#botfindblocksoptions
