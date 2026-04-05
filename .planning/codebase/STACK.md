# Technology Stack

> **Focus:** tech
> **Generated:** 2026-04-06
> **Codebase:** voxel-pilot

## Languages

**Primary:**

- TypeScript 5.9.3 - All application code under `src/`

**Secondary:**

- JSON - Configuration files, package manifests, type definitions
- TOML - Subagent definitions in `.codex/agents/`

## Runtime

**Environment:**

- Node.js >= 18.0.0 (specified in `package.json` engines)
- ESM modules (`"type": "module"` in `package.json`)

**Package Manager:**

- npm (lockfile: `package-lock.json` present)
- `tsx` 4.20.6 for development-time TypeScript execution

## Frameworks

**Core:**

- Mineflayer 4.35.0 - Minecraft bot client library, the foundation for all bot interactions
- XState 5.22.0 - Hierarchical State Machine for bot behavior (`src/hsm/machine.ts` defines a parallel state machine with MAIN_ACTIVITY and MONITORING regions)
- OpenAI SDK 6.32.0 - LLM client for the agent loop, supports both Responses API and Chat Completions API

**Mineflayer Plugins:**

- `mineflayer-pathfinder` 2.4.5 - A\* pathfinding and movement
- `mineflayer-pvp` 1.3.2 - Combat (melee + ranged)
- `mineflayer-armor-manager` 2.0.1 - Automatic armor equipping
- `mineflayer-auto-eat` 5.0.3 - Automatic food consumption
- `mineflayer-tool` 1.2.0 - Optimal tool selection for block breaking
- `mineflayer-movement` 0.4.4 - Micro-movement controller for combat
- `mineflayer-web-inventory` 1.8.5 - Web-based inventory viewer
- `minecrafthawkeye` 1.3.9 - Ranged combat aiming

**AI/LLM:**

- `openai` 6.32.0 - Primary SDK, used via two client implementations:
  - `OpenAIResponsesClient` (`src/ai/client.ts`) - Uses OpenAI Responses API (default for `openai` provider)
  - `OpenAICompatibleChatClient` (`src/ai/client.ts`) - Uses Chat Completions API (for `openrouter`, `openai_compatible`, `routerai` providers)

**Testing:**

- Node.js native test runner (`node:test`) - Tests run via `npx tsx --test src/tests/...`

**Build/Dev:**

- `typescript` 5.9.3 - TypeScript compiler
- `tsc-alias` 1.8.10 - Rewrites path aliases after compilation
- `prettier` 3.6.2 with `@trivago/prettier-plugin-sort-imports` 6.0.2 - Code formatting with import ordering
- `knip` 6.0.0 - Dead code/unused dependency detection

**Utilities:**

- `ajv` 8.17.1 - JSON Schema validation for environment variables (`src/config/env.ts`)
- `better-sqlite3` 12.8.0 - Synchronous SQLite client for persistent memory (`src/core/memory/index.ts`)
- `dotenv` 17.2.1 - Environment variable loading
- `winston` 3.17.0 - Structured logging with correlation IDs (`src/config/logger.ts`)
- `prismarine-viewer` 1.33.0 - 3D world viewer (web-based)
- `vec3` 0.1.10 - 3D vector math (dev dependency for type checking)

## Key Dependencies

**Critical:**

- `mineflayer` 4.35.0 - Core Minecraft protocol client; all bot actions flow through this
- `xstate` 5.22.0 - State machine orchestrating all bot behavior (IDLE → THINKING → EXECUTING loop, COMBAT sub-states, URGENT_NEEDS)
- `openai` 6.32.0 - LLM provider client; the agent loop depends on this for decision-making
- `better-sqlite3` 12.8.0 - Persistent memory storage; bot remembers locations, players, tasks, deaths across sessions

**Infrastructure:**

- `winston` 3.17.0 - Logging framework with file rotation (10MB max, 5 files)
- `ajv` 8.17.1 - Startup environment validation with JSON Schema

## Configuration

**Environment:**

- Loaded via `dotenv` from `.env` file
- Validated at startup with AJV JSON Schema in `src/config/env.ts`
- Required vars: `MINECRAFT_HOST`, `MINECRAFT_PORT`, `MINECRAFT_USERNAME`, `MINECRAFT_VERSION`, `AI_PROVIDER`, `AI_MODEL`
- AI provider enum: `openai`, `routerai`, `openrouter`, `openai_compatible`, `local`, `disabled`
- Config singleton: `src/config/config.ts` exports a typed `Config` class with `minecraft`, `ai`, and `logging` getters

**Build:**

- `tsconfig.json` - Target ES2022, module ESNext, strict mode, path aliases (`@/*`, `@/core/*`, `@/hsm/*`, `@/config/*`, `@/utils/*`, `@/modules/*`)
- `tsc-alias` rewrites `@/` paths in compiled output
- `knip.json` - Dead code detection with matching path alias config
- `.prettierrc` - Tabs, 2-width, no semicolons, single quotes, import ordering plugin

**Runtime Data:**

- `data/` - SQLite memory databases (`bot_memory_<username>.db`)
- `logs/` - Winston log files (`bot.log`, `error.log`)
- `dist/` - Compiled JavaScript output

## Platform Requirements

**Development:**

- Node.js >= 18.0.0
- Minecraft server (local or remote) matching `MINECRAFT_VERSION`
- `.env` file with server credentials and AI API key

**Production:**

- Node.js runtime (compiled via `npm run build`, run via `npm start`)
- Minecraft server connection
- AI provider API key (unless `AI_PROVIDER=disabled` or `local`)
- File system write access for `data/` and `logs/` directories

---

_Stack analysis: 2026-04-06_
