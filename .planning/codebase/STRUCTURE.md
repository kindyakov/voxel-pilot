# Codebase Structure

> **Focus:** architecture
> **Generated:** 2026-04-06
> **Codebase:** voxel-pilot (Minecraft AI bot)

## Directory Layout

```
voxel-pilot/
├── src/                      # All source code
│   ├── index.ts              # Entrypoint — bootstrap and SIGINT handler
│   ├── ai/                   # AI agent loop, LLM clients, tool definitions
│   │   ├── loop.ts           # runAgentTurn — main AI decision cycle
│   │   ├── tools.ts          # Tool definitions, inline/execution/control categorization
│   │   ├── client.ts         # OpenAIResponsesClient, OpenAICompatibleChatClient
│   │   ├── snapshot.ts       # buildSnapshot — deterministic state summary for LLM
│   │   ├── taskContext.ts    # Task context tracking, grounded facts
│   │   ├── AgentLoopGuard.ts # Anti-stuck guard for agent loop
│   │   └── runtime/          # Runtime inspection helpers
│   │       ├── inspect.ts    # inspectNearbyBlocks, inspectNearbyEntities
│   │       └── window.ts     # Window session open/describe/close
│   ├── config/               # Configuration and logging
│   │   ├── config.ts         # Config singleton (minecraft, ai, logging)
│   │   ├── env.ts            # Ajv-based env validation schema
│   │   └── logger.ts         # Winston logger with correlation IDs
│   ├── core/                 # Bot bootstrap and persistent services
│   │   ├── bot.ts            # MinecraftBot class — lifecycle, reconnect
│   │   ├── CommandHandler.ts # Chat command parser (:command syntax)
│   │   ├── hsm.ts            # BotStateMachine — XState actor wrapper
│   │   └── memory/           # SQLite-backed persistent memory
│   │       ├── index.ts      # MemoryManager class
│   │       └── types.ts      # MemoryEntry, BotMemoryData, etc.
│   ├── hsm/                  # XState v5 state machine
│   │   ├── machine.ts        # createBotMachine — full machine definition
│   │   ├── context.ts        # MachineContext interface + default context
│   │   ├── types.ts          # MachineEvent types, guard/action signatures
│   │   ├── actors/           # Invoked actors
│   │   │   ├── combat.actors.ts      # Melee, ranged, approaching, fleeing
│   │   │   ├── monitoring.actors.ts  # Entity tracking service
│   │   │   └── primitives/   # Primitive action actors
│   │   │       ├── primitiveBreaking.primitive.ts
│   │   │       ├── primitiveCloseWindow.primitive.ts
│   │   │       ├── primitiveFollowing.primitive.ts
│   │   │       ├── primitiveNavigating.primitive.ts
│   │   │       ├── primitiveOpenWindow.primitive.ts
│   │   │       ├── primitivePlacing.primitive.ts
│   │   │       └── primitiveTransferItem.primitive.ts
│   │   ├── guards/           # Guard functions
│   │   │   └── combat.guards.ts
│   │   ├── helpers/          # HSM utilities
│   │   │   └── createStatefulService.ts
│   │   └── utils/            # Low-level HSM helpers
│   │       ├── antiLoop.ts   # AntiLoopGuard class
│   │       └── isEntityOfType.ts
│   ├── modules/              # Mineflayer plugins and connection wiring
│   │   ├── connection/
│   │   │   └── index.ts      # initConnection — plugin loading, event bridging
│   │   └── plugins/
│   │       ├── index.plugins.ts  # loadPlugins, initPlugins
│   │       ├── pathfinder.ts     # mineflayer-pathfinder setup
│   │       ├── movement.ts       # mineflayer-movement setup
│   │       ├── armorManager.ts   # mineflayer-armor-manager
│   │       ├── autoEat.ts        # mineflayer-auto-eat
│   │       ├── pvp.ts            # mineflayer-pvp
│   │       ├── hawkeye.ts        # minecrafthawkeye
│   │       ├── tool.ts           # mineflayer-tool
│   │       ├── viewer.ts         # prismarine-viewer
│   │       ├── webInventory.ts   # mineflayer-web-inventory
│   │       └── goals.ts          # GoalFollow, GoalXZ exports
│   ├── types/                # Shared type definitions
│   │   ├── index.ts          # Bot interface, re-exports from prismarine
│   │   └── external/
│   │       └── mineflayer-web-inventory.d.ts
│   ├── utils/                # Shared helpers
│   │   ├── combat/
│   │   │   ├── enemyVisibility.ts    # canSeeEnemy, canAttackEnemy
│   │   │   └── movementController.ts # hasMovementController
│   │   ├── general/
│   │   │   ├── index.general.utils.ts
│   │   │   ├── generateId.ts
│   │   │   └── sleep.ts
│   │   └── minecraft/
│   │       └── botUtils.ts   # BotUtils class (food, weapons, arrows)
│   └── tests/                # Test suites by subsystem
│       ├── ai/               # Agent loop, snapshot, window runtime tests
│       ├── config/           # Config validation tests
│       ├── core/             # Command handler, OpenAI client, memory tests
│       │   └── memory/       # MemoryManager CRUD tests
│       ├── hsm/              # Machine, combat, anti-loop tests
│       └── utils/            # Enemy visibility tests
├── data/                     # Runtime state (SQLite databases)
├── dist/                     # Compiled JavaScript output
├── logs/                     # Winston log files
├── docs/                     # Documentation
├── .codex/agents/            # Subagent definitions (TOML)
├── .agents/skills/           # Agent skills
├── package.json              # Dependencies and scripts
├── tsconfig.json             # TypeScript config with path aliases
├── .prettierrc               # Code formatting config
├── .env.example              # Environment variable template
└── knip.json                 # Unused code detection config
```

## Directory Purposes

**`src/ai/` — AI Agent Loop:**

- Purpose: LLM-driven decision making for bot tasks
- Contains: Agent turn execution, tool definitions, model client adapters, snapshot builder, runtime inspection
- Key files: `src/ai/loop.ts` (main loop), `src/ai/tools.ts` (tool schemas), `src/ai/client.ts` (model clients)

**`src/config/` — Configuration:**

- Purpose: Environment validation and typed config access
- Contains: Config singleton, Ajv schema, Winston logger
- Key files: `src/config/config.ts` (main config), `src/config/env.ts` (validation), `src/config/logger.ts` (logging)

**`src/core/` — Core Services:**

- Purpose: Bot lifecycle, HSM wiring, command handling, persistent memory
- Contains: `MinecraftBot`, `BotStateMachine`, `CommandHandler`, `MemoryManager`
- Key files: `src/core/bot.ts` (lifecycle), `src/core/hsm.ts` (state machine wrapper), `src/core/memory/index.ts` (SQLite memory)

**`src/hsm/` — State Machine:**

- Purpose: XState v5 machine definition, actors, guards, and utilities
- Contains: Machine definition, context, types, combat actors, monitoring actors, primitive actors, guards
- Key files: `src/hsm/machine.ts` (machine), `src/hsm/context.ts` (context), `src/hsm/helpers/createStatefulService.ts` (service factory)

**`src/modules/` — Mineflayer Plugins:**

- Purpose: Plugin initialization and connection event bridging
- Contains: Plugin loaders for pathfinder, movement, combat, auto-eat, etc.
- Key files: `src/modules/plugins/index.plugins.ts` (plugin registry), `src/modules/connection/index.ts` (connection init)

**`src/types/` — Shared Types:**

- Purpose: Centralized type definitions and re-exports
- Contains: `Bot` interface (augmented Mineflayer bot), re-exports from prismarine packages
- Key files: `src/types/index.ts` (main types)

**`src/utils/` — Utilities:**

- Purpose: Domain-specific helper functions
- Contains: Combat visibility checks, movement controller, general helpers, bot utilities
- Key files: `src/utils/combat/enemyVisibility.ts`, `src/utils/minecraft/botUtils.ts`

**`src/tests/` — Tests:**

- Purpose: Subsystem-specific test suites
- Contains: Tests organized by domain (`ai`, `config`, `core`, `hsm`, `utils`)
- Run with: `npx tsx --test src/tests/...`

**`data/` — Runtime Data:**

- Purpose: Persistent SQLite databases for bot memory
- Contains: `bot_memory_<username>.db` files
- Generated: Yes, at runtime
- Committed: No (should be in `.gitignore`)

**`logs/` — Log Files:**

- Purpose: Winston log output
- Contains: `bot.log`, `error.log` (rotated, max 10MB each, 5 files)
- Generated: Yes, at runtime
- Committed: No

**`.codex/agents/` — Subagent Definitions:**

- Purpose: Project-specific subagent configurations for Codex
- Contains: TOML files defining agent roles (`hardening-worker`, `hsm-mapper`, `mineflayer-archivist`, `reviewer-hardline`, `test-writer`)

## Key File Locations

**Entry Points:**

- `src/index.ts`: Process entry point — creates `MinecraftBot`, handles SIGINT
- `src/core/bot.ts`: `MinecraftBot` class — start/stop/reconnect lifecycle

**Configuration:**

- `src/config/config.ts`: Config singleton with `minecraft`, `ai`, `logging` sections
- `src/config/env.ts`: Ajv JSON schema for env validation
- `.env.example`: Template for required environment variables

**Core Logic:**

- `src/hsm/machine.ts`: Full XState machine definition (~700 lines)
- `src/hsm/context.ts`: MachineContext interface and default values
- `src/ai/loop.ts`: Agent turn execution with grounded tool validation
- `src/ai/tools.ts`: Tool definitions (16 tools across 3 categories)
- `src/core/memory/index.ts`: MemoryManager with SQLite CRUD operations

**HSM Actors:**

- `src/hsm/actors/combat.actors.ts`: Melee, ranged, approaching, fleeing services
- `src/hsm/actors/monitoring.actors.ts`: Entity tracking service
- `src/hsm/actors/primitives/*.primitive.ts`: 7 primitive action actors

**Testing:**

- `src/tests/ai/`: Agent loop, guard, snapshot, window runtime tests
- `src/tests/hsm/`: Machine, combat runtime, combat regression, anti-loop tests
- `src/tests/core/memory/`: MemoryManager CRUD tests

## Naming Conventions

**Files:**

- PascalCase for classes: `CommandHandler.ts`, `BotUtils.ts`, `MemoryManager` (in file `index.ts`)
- camelCase for modules: `loop.ts`, `tools.ts`, `client.ts`, `snapshot.ts`
- Suffix convention for HSM files:
  - `*.machine.ts` or `machine.ts` — machine definitions
  - `*.guards.ts` — guard functions
  - `*.actors.ts` — actor collections
  - `*.primitive.ts` — primitive action actors
  - `*.update.ts` — context update actions (pattern, not currently used)
- Barrel files: `index.ts`, `index.plugins.ts`, `index.general.utils.ts`

**Directories:**

- camelCase: `ai/`, `config/`, `core/`, `hsm/`, `modules/`, `types/`, `utils/`
- Plural for collections: `actors/`, `guards/`, `helpers/`, `utils/`, `plugins/`, `tests/`

**Functions:**

- camelCase: `runAgentTurn`, `buildSnapshot`, `createAgentClient`, `createStatefulService`
- Factory functions prefixed with `create`: `createBotMachine`, `createAgentClient`, `createMineflayerBot`
- Init functions prefixed with `init`: `initConnection`, `initPlugins`, `initAutoEat`
- Load functions prefixed with `load`: `loadPlugins`, `loadPathfinder`, `loadPvp`

**Variables:**

- camelCase for locals and parameters
- UPPER_SNAKE_CASE for constants: `MAX_INLINE_TOOL_ROUNDS`, `DB_VERSION`, `AGENT_SYSTEM_PROMPT`
- Private class fields use `private readonly` prefix

**Types:**

- PascalCase for interfaces: `MachineContext`, `MachineEvent`, `Bot`, `MemoryEntry`
- PascalCase for type aliases: `AgentToolName`, `InlineToolName`, `ExecutionToolName`
- Suffix convention: `*Config`, `*State`, `*Input`, `*Result`

**Events:**

- UPPER_SNAKE_CASE with verb prefix: `UPDATE_HEALTH`, `START_COMBAT`, `USER_COMMAND`, `NAVIGATION_FAILED`

## Where to Add New Code

**New AI Tool:**

- Add tool definition to `AGENT_TOOLS` array in `src/ai/tools.ts`
- Add tool name to appropriate union type (`InlineToolName`, `ExecutionToolName`, or `ControlToolName`)
- If inline: add handler to `executeInlineToolCall()` switch in `src/ai/tools.ts`
- If execution: add primitive actor in `src/hsm/actors/primitives/`, wire into `resolveExecutionActor()` and `resolveExecutionInput()` in `src/hsm/machine.ts`
- Add corresponding event types to `src/hsm/types.ts`

**New HSM State:**

- Add state definition to `src/hsm/machine.ts` within the appropriate parent state
- Add guards to `src/hsm/guards/` if needed
- Add actors to `src/hsm/actors/` if invoking a service
- Add event types to `src/hsm/types.ts` if new events are emitted
- Update `MachineContext` in `src/hsm/context.ts` if new context fields are needed

**New Mineflayer Plugin:**

- Create plugin loader in `src/modules/plugins/<name>.ts` with `loadPlugin(bot)` and optionally `initPlugin(bot)`
- Register in `src/modules/plugins/index.plugins.ts` `loadPlugins()` and/or `initPlugins()`
- Add type augmentations to `src/types/index.ts` `Bot` interface if the plugin adds new bot properties

**New Utility:**

- Combat-related: `src/utils/combat/<name>.ts`
- General helpers: `src/utils/general/<name>.ts`
- Minecraft-specific: `src/utils/minecraft/<name>.ts`
- Export from domain barrel file if applicable

**New Test:**

- Place in `src/tests/<subsystem>/<name>.test.ts`
- Use Node's built-in test runner: `npx tsx --test src/tests/<subsystem>/<name>.test.ts`

**New Configuration Option:**

- Add to Ajv schema in `src/config/env.ts`
- Add to appropriate config interface in `src/config/config.ts`
- Add to `.env.example`
- Update `Config` constructor to read and parse the value

**New Memory Field:**

- Add to `BotMemoryData` in `src/core/memory/types.ts`
- Add to `createDefaultState()` in `src/core/memory/index.ts`
- If persisted to SQLite, add migration logic (not currently implemented — schema is fixed)

## Special Directories

**`data/`:**

- Purpose: Runtime SQLite databases for bot memory
- Generated: Yes, on first bot start
- Committed: No — contains per-bot persistent state
- Structure: `bot_memory_<username>.db` per bot instance

**`dist/`:**

- Purpose: Compiled JavaScript output from TypeScript
- Generated: Yes, by `npm run build` (`tsc && tsc-alias`)
- Committed: No
- Entry: `dist/index.js`

**`logs/`:**

- Purpose: Winston log files
- Generated: Yes, on bot start
- Committed: No
- Structure: `bot.log` (all levels), `error.log` (errors only), rotated at 10MB, 5 files max

**`.codex/agents/`:**

- Purpose: Subagent role definitions for Codex AI
- Contains: TOML files with agent responsibilities
- Current agents: `hardening-worker`, `hsm-mapper`, `mineflayer-archivist`, `reviewer-hardline`, `test-writer`

**`.agents/skills/`:**

- Purpose: Agent skill definitions (e.g., XState v5 skill)
- Contains: `xstate/SKILL.md` and potentially others

---

_Structure analysis: 2026-04-06_
