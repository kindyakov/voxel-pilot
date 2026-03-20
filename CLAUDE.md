# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

```bash
# Development (watch mode with tsx)
npm run dev

# Build TypeScript to JavaScript
npm build

# Type checking (without emitting)
npm run type-check

# Code formatting
npm run format

# Clean build artifacts
npm run clean

# Start the built bot
npm start
```

## Project Overview

This is a **Minecraft bot** using **xstate** (v5) for state management and **mineflayer** for game interaction. The bot uses a hierarchical state machine (HSM) with a 3-level task execution system:

1. **Level 1 (Primitives)**: Atomic services - single actions like searching, navigating, breaking blocks
2. **Level 2 (Tasks)**: Task orchestrators - sequences of primitives for complex operations (mining, crafting, smelting)
3. **Level 3 (Plan Executor)**: Manages sequential task execution from AI-generated plans

## High-Level Architecture

### Core Systems

- **HSM (Hierarchical State Machine)** (`src/hsm/machine.ts`):
  - Uses xstate parallel states for managing bot activity
  - Main state hierarchy: `MAIN_ACTIVITY` → `IDLE | URGENT_NEEDS | COMBAT | TASKS | MONITORING`
  - Uses history states to resume interrupted activities

- **Bot Core** (`src/core/bot.ts`):
  - Initializes mineflayer connection
  - Sets up HSM, memory system, and command handler
  - Manages reconnection and bot lifecycle

- **Memory System** (`src/core/memory.ts`):
  - Two-tier memory: short-term (context) and long-term (persistent JSON file at `data/bot_memory.json`)
  - Stores known locations, player interactions, task statistics, deaths, and world exploration data
  - Auto-saves every 5 minutes and on shutdown

### Plugin Architecture

Mineflayer plugins loaded in `src/modules/plugins/index.plugins.ts`:
- `armorManager` - Equipment management
- `autoEat` - Automatic food consumption
- `pathfinder` - A* pathfinding
- `pvp` - Combat mechanics
- `movement` - Advanced movement control
- `tool` - Tool management
- `viewer` - Web-based world viewer
- `webInventory` - Inventory management UI
- `hawkeye` - Entity detection utilities

### Primitive Services (Atomic Actions)

Located in `src/hsm/actors/primitives/`, created via `createStatefulService()` helper:
- `primitiveSearchBlock` - Find blocks in world with memory integration
- `primitiveSearchEntity` - Find mobs/players
- `primitiveNavigating` - Move to target with pathfinding
- `primitiveBreaking` - Break blocks
- `primitivePlacing` - Place blocks
- `primitiveOpenContainer` - Open chests/furnaces/crafting tables

Registry in `src/hsm/primitives/registry.primitives.ts` for validation and documentation.

### Task Orchestrators

Located in `src/hsm/tasks/registry.tasks.ts`. Each task:
- Defines required/optional parameters
- Specifies execution preconditions
- Orchestrates primitive services sequentially
- Saves progress in `context.taskData` for resumption on interruption

Typical examples: MINING, SMELTING, CRAFTING, BUILDING tasks.

### Actions & Guards

**Actions** (`src/hsm/actions/`):
- Entry/exit handlers for state transitions
- Always-running actions
- Periodic state updates
- Save operations
- Organized by feature: `combat.ts`, `mining.ts`, `monitoring.ts`, etc.

**Guards** (`src/hsm/guards/`):
- Conditions for state transitions
- Check preconditions before state changes
- Located in guard files by feature

## Key Architectural Principles

### Separation of Concerns

- **Primitives**: Know nothing about tasks or goals; single atomic actions
- **Tasks**: Sequence primitives toward objectives; don't know about plans
- **Plan Executor**: Manages task sequences from AI plans

### Services vs States

Primitives are **services (actors)**, NOT state machine states:
- Invoked via `invoke` from task states
- Have lifecycle: `onStart` → `onTick` | `onAsyncTick` | `onEvents` → `onCleanup`
- Communicate with state machine via `sendBack()` events

### Parameter Flow

Parameters flow through `input` at each level:

```
AI generates Plan
  → Plan Executor receives tasks and validates
  → Task orchestrator receives params via input
  → Primitive receives params via input
```

### Priority System

Interruption priorities defined in `src/hsm/config/priorities.ts`:
- FOLLOWING: 9
- EMERGENCY_HEALING: 8
- EMERGENCY_EATING: 8
- COMBAT: 7
- PLAN_EXECUTOR: 6
- IDLE: 1

Higher priority states can interrupt lower ones. Use history states to resume interrupted activity.

## TypeScript Configuration

- **Path aliases** (tsconfig.json): `@/*`, `@hsm/*`, `@config/*`, `@utils/*`, `@modules/*`, `@core/*`
- **Target**: ES2022
- **Module**: ESNext
- **Strict mode**: Enabled with full strictness checks
- **Build tool**: tsc + tsc-alias for resolving path aliases

## Memory System Details

### Long-term Memory Structure (`data/bot_memory.json`)

```
meta: { botName, createdAt, lastUpdated, version }
world: { knownLocations, knownPlayers }
experience: { tasksCompleted, deaths, achievements }
goals: { current, completed, failed }
preferences: { favoriteTools, avoidAreas, preferredMiningDepth }
stats: { totalPlaytime, blocksMined, blocksPlaced, itemsCrafted, mobsKilled, distanceTraveled }
```

### Memory API

- `bot.hsm.memory.rememberLocation(type, position, metadata)`
- `bot.hsm.memory.findNearestKnown(type, currentPosition)`
- `bot.hsm.memory.rememberTask(taskType, success, duration)`
- `bot.hsm.memory.updateStats(type, item, count)`

## Validation System (3 Levels)

1. **Preconditions**: Defined in Task Registry (static checks)
2. **Plan Validation**: Before execution starts (validate all tasks)
3. **Runtime Checks**: During execution (dynamic conditions)

## File Structure Summary

```
src/
├── core/              # Bot initialization, HSM, memory, command handler
├── hsm/               # State machine implementation
│   ├── actors/        # Primitive services
│   ├── actions/       # Entry/exit/update/always handlers
│   ├── guards/        # State transition conditions
│   ├── tasks/         # Task registries and types
│   ├── primitives/    # Primitive registry
│   ├── config/        # Priorities config
│   ├── utils/         # HSM utilities (antiLoop, blockAnalysis, entityDetection)
│   └── helpers/       # createStatefulService helper
├── modules/
│   ├── connection/    # Mineflayer setup
│   └── plugins/       # Mineflayer plugins
├── utils/
│   ├── combat/        # Combat utilities
│   ├── minecraft/     # Bot utilities
│   └── general/       # General utilities
├── types/             # Type definitions
└── index.ts           # Entry point
```

## Documentation

Comprehensive guides in `docs/`:
- `architecture.md` - Full architecture explanation
- `primitives-guide.md` - Primitive service reference
- `tasks-guide.md` - Task orchestrator patterns
- `memory-guide.md` - Memory system details
- `validation-guide.md` - Validation system
- `bot_architecture_plan.md` - Design documentation
- `enemy-visibility-system.md` - Enemy detection mechanics
- `implementation-plan.md` - Development roadmap

## Common Development Tasks

### Adding a New Primitive Service

1. Create `src/hsm/actors/primitives/primitive[Name].primitive.ts`
2. Use `createStatefulService()` helper with lifecycle handlers
3. Add to `PRIMITIVE_REGISTRY` in `src/hsm/primitives/registry.primitives.ts`
4. Export from `src/hsm/actors/primitives/index.primitive.ts`

### Adding a New Task

1. Add task type to `src/hsm/tasks/types.ts`
2. Define task in `TASK_REGISTRY` in `src/hsm/tasks/registry.tasks.ts` with preconditions
3. Implement task orchestration logic (invokes primitives in sequence)
4. Create entry/exit/update actions if needed in `src/hsm/actions/`
5. Add guards in `src/hsm/guards/` if conditional logic needed

### Adding a New HSM State

1. Define state in `machine.ts` with appropriate nesting
2. Create entry/exit actions in `src/hsm/actions/entry/` and `src/hsm/actions/exit/`
3. Add guards in `src/hsm/guards/` if transitions are conditional
4. Use `invoke` for async operations or service calls
5. Define transitions with appropriate priority considerations

## Debugging Tips

- Use `npm run dev` for watch mode development
- Bot logs to `logs/bot.log` (info) and `logs/error.log` (errors)
- Use Logger from `@config/logger` for consistent logging
- Memory can be inspected at `data/bot_memory.json`
- HSM context available in all state handlers and services via parameter
- Check `antiLoop` utility in `src/hsm/utils/antiLoop.ts` for stuck detection
