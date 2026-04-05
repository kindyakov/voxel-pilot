# Architecture

> **Focus:** architecture
> **Generated:** 2026-04-06
> **Codebase:** voxel-pilot (Minecraft AI bot)

## Pattern Overview

**Overall:** Event-driven state machine with AI agent loop (XState v5)

The bot is a Mineflayer client augmented with an XState v5 hierarchical state machine (HSM) that governs all behavior. An LLM-powered agent loop (`IDLE → THINKING → EXECUTING → DECIDE_NEXT`) produces tool decisions, which are resolved into primitive state-machine actors. Combat runs in parallel with the task system and can pre-empt any state.

**Key Characteristics:**

- **Hierarchical parallel state machine** — `MAIN_ACTIVITY` (IDLE / TASKS / COMBAT / URGENT_NEEDS) runs alongside `MONITORING` (health, hunger, entity tracking)
- **AI-driven task execution** — LLM receives a deterministic snapshot and returns one tool decision per turn
- **Grounded tool execution** — execution tools (`navigate_to`, `break_block`, etc.) require world facts grounded by inline inspection tools in the same turn
- **Combat pre-emption** — any state can be interrupted by combat when an enemy enters range
- **Anti-loop protection** — state transitions are monitored; excessive looping triggers an emergency shutdown
- **Persistent memory** — SQLite-backed long-term memory for locations, containers, resources, and experience

## Layers

**Entrypoint / Bootstrap:**

- Purpose: Create and manage the Mineflayer bot lifecycle
- Location: `src/index.ts`, `src/core/bot.ts`
- Contains: `MinecraftBot` class with start/stop/reconnect logic
- Depends on: `mineflayer`, `Config`, `Logger`, `BotStateMachine`, `CommandHandler`, `MemoryManager`
- Used by: process entry point

**Configuration:**

- Purpose: Validate and provide typed access to environment variables
- Location: `src/config/config.ts`, `src/config/env.ts`, `src/config/logger.ts`
- Contains: `Config` singleton, Ajv-based env validation, Winston logger with correlation IDs
- Depends on: `dotenv`, `ajv`, `winston`
- Used by: all layers

**HSM (State Machine):**

- Purpose: Define and run the bot's behavior as an XState v5 machine
- Location: `src/hsm/machine.ts`, `src/hsm/context.ts`, `src/hsm/types.ts`
- Contains: Machine definition, context shape, event types, guards, actions, actor registry
- Depends on: `xstate`, primitive actors, combat actors, monitoring actors, AI loop
- Used by: `BotStateMachine` wrapper in `src/core/hsm.ts`

**AI Agent Loop:**

- Purpose: LLM-driven decision making for task execution
- Location: `src/ai/loop.ts`, `src/ai/tools.ts`, `src/ai/snapshot.ts`, `src/ai/client.ts`
- Contains: `runAgentTurn`, tool definitions, snapshot builder, OpenAI client adapters
- Depends on: `openai` SDK, `MemoryManager`, runtime inspection modules
- Used by: `defaultThinkingActor` in `src/hsm/machine.ts`

**Core Services:**

- Purpose: Wire bot subsystems together (HSM, memory, commands)
- Location: `src/core/hsm.ts`, `src/core/CommandHandler.ts`, `src/core/memory/index.ts`
- Contains: `BotStateMachine` wrapper, `CommandHandler` for chat commands, `MemoryManager` for SQLite persistence
- Depends on: HSM, AI, memory types, Mineflayer bot instance
- Used by: `MinecraftBot` during `botReady`

**Mineflayer Plugins:**

- Purpose: Extend Mineflayer with pathfinding, combat, auto-eat, etc.
- Location: `src/modules/plugins/*.ts`
- Contains: pathfinder, movement, armor manager, auto-eat, pvp, hawkeye, tool, viewer, web inventory
- Depends on: `mineflayer-pathfinder`, `mineflayer-pvp`, `mineflayer-auto-eat`, `minecrafthawkeye`, `mineflayer-armor-manager`, `mineflayer-tool`
- Used by: connection init and HSM primitive actors

**Utilities:**

- Purpose: Shared helpers for combat, general operations, and Minecraft-specific logic
- Location: `src/utils/combat/`, `src/utils/general/`, `src/utils/minecraft/`
- Contains: enemy visibility checks, movement controller, sleep helper, bot utilities
- Depends on: Mineflayer bot instance
- Used by: combat actors, guards, HSM actions

## Data Flow

**Bot Startup:**

1. `src/index.ts` instantiates `MinecraftBot` and calls `start()`
2. `MinecraftBot.start()` creates a Mineflayer bot via `Config.minecraft` options
3. `initConnection()` in `src/modules/connection/index.ts` loads plugins and wires `spawn` → `botReady` event
4. On `botReady`: `BotUtils`, `MemoryManager`, `BotStateMachine`, and `CommandHandler` are attached to the bot instance
5. Memory is loaded from SQLite (`data/bot_memory_<username>.db`)
6. XState actor is created and started with `createActor(machine, { input: { bot } })`
7. Pending events are flushed; anti-loop observer is attached

**Task Execution (AI Agent Loop):**

1. Player sends chat command `:do something` → `CommandHandler` emits `USER_COMMAND` event
2. HSM transitions from `IDLE` → `TASKS.THINKING`, storing the goal in context
3. `defaultThinkingActor` invokes `runAgentTurn()` with current snapshot and context
4. Snapshot is built from bot state, goal context, feedback errors, and active window session
5. LLM client (OpenAI Responses API or Chat Completions API) receives system prompt + snapshot + tool definitions
6. Inline tools (`memory_read`, `inspect_blocks`, `inspect_entities`, `inspect_inventory`, `inspect_window`) execute within the turn, grounding world facts
7. LLM returns one execution tool (`navigate_to`, `break_block`, `place_block`, `follow_entity`, `open_window`, `transfer_item`, `close_window`) or `finish_goal`
8. HSM transitions to `TASKS.EXECUTING` → resolves to the correct primitive actor
9. Primitive actor runs (pathfinding, block breaking, etc.) and emits success/failure event
10. HSM records result, transitions to `DECIDE_NEXT`, which either loops back to `THINKING` or returns to `IDLE`

**Combat Flow:**

1. `serviceEntitiesTracking` (monitoring actor, 100ms tick) scans entities, filters enemies, checks reachability via pathfinding
2. Sends `UPDATE_ENTITIES` with nearest reachable enemy
3. If `autoDefend` is enabled and enemy is in range, HSM transitions to `COMBAT`
4. `DECIDING` state uses guards to route to: `FLEEING`, `MELEE_ATTACKING`, `RANGED_SKIRMISHING`, or `APPROACHING`
5. Combat actors run on their own tick intervals (250-500ms) and emit events when enemy distance changes
6. Combat can be pre-empted by urgent needs (health/food critical)

**State Update Flow:**

1. Mineflayer emits events (`health`, `breath`, `move`, `death`, `entityDead`, `itemDrop`)
2. `BotStateMachine.setupBotEvents()` translates these to HSM events (`UPDATE_HEALTH`, `UPDATE_FOOD`, `UPDATE_POSITION`, `DEATH`, etc.)
3. HSM actions update context via `assign()`
4. Monitoring sub-states (HEALTH_MONITOR, HUNGER_MONITOR) check thresholds and may trigger `URGENT_NEEDS`

**State Management:**

- XState v5 `setup()` + `createMachine()` defines the machine
- Context is typed via `MachineContext` interface in `src/hsm/context.ts`
- Context is initialized with defaults and merged with bot instance at creation
- All state mutations go through `assign()` actions; no direct context mutation
- Services use `createStatefulService()` factory which wraps `fromCallback` with tick intervals, abort signals, and cleanup

## Key Abstractions

**Machine Context (`src/hsm/context.ts`):**

- Purpose: Single source of truth for all bot state visible to the HSM
- Shape: bot reference, vitals (health/food/oxygen), entities, inventory, position, preferences, goal state, execution state, failure tracking
- Pattern: Immutable-by-convention; updated only through `assign()` actions
- Examples: `src/hsm/context.ts` (type + default context)

**Agent Tool System (`src/ai/tools.ts`):**

- Purpose: Define the set of tools the LLM can call, categorized as inline, execution, or control
- Categories:
  - **Inline tools** (8): `memory_save`, `memory_read`, `memory_update_data`, `memory_delete`, `inspect_inventory`, `inspect_blocks`, `inspect_entities`, `inspect_window` — execute within the thinking turn
  - **Execution tools** (7): `navigate_to`, `break_block`, `place_block`, `follow_entity`, `open_window`, `transfer_item`, `close_window` — transition HSM to a primitive state
  - **Control tool** (1): `finish_goal` — ends the current goal
- Pattern: Grounded execution — execution tools require world facts from inline tools in the same turn

**Primitive Actors (`src/hsm/actors/primitives/*.primitive.ts`):**

- Purpose: XState actors that perform concrete world actions
- Files:
  - `src/hsm/actors/primitives/primitiveNavigating.primitive.ts` — pathfinding to position
  - `src/hsm/actors/primitives/primitiveBreaking.primitive.ts` — block breaking
  - `src/hsm/actors/primitives/primitivePlacing.primitive.ts` — block placing
  - `src/hsm/actors/primitives/primitiveOpenWindow.primitive.ts` — open container
  - `src/hsm/actors/primitives/primitiveCloseWindow.primitive.ts` — close container
  - `src/hsm/actors/primitives/primitiveTransferItem.primitive.ts` — move items between zones
  - `src/hsm/actors/primitives/primitiveFollowing.primitive.ts` — follow entity
- Pattern: Each primitive is a `fromPromise` or `fromCallback` actor that receives bot + options and emits typed events

**Stateful Service Factory (`src/hsm/helpers/createStatefulService.ts`):**

- Purpose: Unified factory for creating tick-based services invoked by the HSM
- Supports: sync ticks (`onTick`), async ticks (`onAsyncTick`), event subscriptions (`onEvents`), lifecycle hooks (`onStart`, `onCleanup`)
- Pattern: Wraps `fromCallback` with abort controller, internal state management, and `sendBack` for event emission

**Memory Manager (`src/core/memory/index.ts`):**

- Purpose: SQLite-backed persistent memory for the bot
- Storage: `data/bot_memory_<username>.db`
- Tables: `memory_entries` (type, position, tags, description, data), `memory_meta` (key-value metadata)
- CRUD: `saveEntry`, `readEntries`, `updateEntryData`, `deleteEntry`
- Domain helpers: `rememberLocation`, `rememberPlayer`, `rememberTask`, `rememberDeath`, `updateStats`
- Auto-save: `setInterval` every 5 minutes in `src/core/bot.ts`

**Anti-Loop Guard (`src/hsm/utils/antiLoop.ts`):**

- Purpose: Detect and stop infinite state machine loops
- Config: `maxTransitionsPerSecond: 20`, `emergencyStopAfter: 100`, `windowMs: 1000`
- Pattern: Records state signature per transition; if rate exceeds threshold, triggers `process.exit(1)`

**Model Client Abstraction (`src/ai/client.ts`):**

- Purpose: Unified `AgentModelClient` interface with two implementations
- `OpenAIResponsesClient` — uses OpenAI Responses API (default for `openai` provider)
- `OpenAICompatibleChatClient` — uses Chat Completions API with session history (for `openrouter`, `routerai`, `openai_compatible`)
- Factory: `createAgentClient()` selects implementation based on `config.ai.provider`

## Entry Points

**`src/index.ts`:**

- Location: `src/index.ts`
- Triggers: `node dist/index.js` or `tsx watch src/index.ts`
- Responsibilities: Instantiate `MinecraftBot`, call `start()`, handle `SIGINT` for graceful shutdown

**`src/core/bot.ts` — `MinecraftBot.start()`:**

- Location: `src/core/bot.ts`
- Triggers: Called from `src/index.ts`
- Responsibilities: Create Mineflayer bot, wire event handlers, initialize subsystems on `botReady`, manage reconnect with exponential backoff (max 5 attempts, base 3s delay)

**`src/hsm/machine.ts` — `createBotMachine()`:**

- Location: `src/hsm/machine.ts`
- Triggers: Called by `BotStateMachine.init()` after memory load
- Responsibilities: Create the XState machine with all states, guards, actions, and actors

**Chat Command Interface:**

- Location: `src/core/CommandHandler.ts`
- Triggers: Mineflayer `chat` event
- Responsibilities: Parse `:`-prefixed commands, emit `USER_COMMAND` or `STOP_CURRENT_GOAL` events to HSM

## Error Handling

**Strategy:** Event-driven error propagation through HSM with typed error events

**Patterns:**

- **Primitive failures** → emit typed failure events (`NAVIGATION_FAILED`, `BREAKING_FAILED`, etc.) → `recordExecutionFailure` action updates context with reason, failure signature, and repeat count
- **AI loop errors** → `onError` handler in THINKING state → `clearGoal` and return to IDLE
- **Service errors** → `sendBack({ type: 'ERROR', error: ... })` from stateful services → caught by HSM
- **Anti-loop emergency** → `process.exit(1)` after 1-second grace period with chat notification
- **Reconnection** — exponential backoff in `MinecraftBot.scheduleReconnect()` (3s, 6s, 12s, 24s, 48s)
- **Model retries** — up to `MAX_MODEL_RETRIES` (1) if LLM returns no tool call

## Cross-Cutting Concerns

**Logging:** Winston via `src/config/logger.ts` with correlation IDs, console + file transports, structured JSON metadata. HSM states log entry/exit with target and distance. AI turns log start/finish/error with transcript metadata.

**Validation:** Ajv-based env validation in `src/config/env.ts` with JSON schema. Tool argument validation in `src/ai/loop.ts` (grounded reference checks, task context constraints).

**Authentication:** Provider API key via `AI_API_KEY` env var, validated by `Config.assertAIConfigured()`. Minecraft server auth via Mineflayer options from env.

**Movement Ownership:** Tracked via `movementOwner` in context (`'NONE' | 'PATHFINDER' | 'PVP' | 'MOVEMENT'`). Set by HSM actions when entering combat or task states to prevent conflicting movement commands.

**Window Session Management:** Active window sessions tracked in context (`activeWindowSession`, `activeWindowSessionState`). Runtime in `src/ai/runtime/window.ts` handles open/describe/close lifecycle with stale session detection.

---

_Architecture analysis: 2026-04-06_
